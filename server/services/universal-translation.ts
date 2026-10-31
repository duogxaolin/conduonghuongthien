import { and, asc, count, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import { getDb, type Database } from '../utils/db'
import { articles, articleTranslations, languages, langTranslations, pageBlocks } from '../db/schema'
import { callAi } from './ai-gateway'
import { upsertTranslations } from './languages'
import { MODEL_TRANSLATION_ANSWER_FORMAT, readModelTranslations } from '../utils/ai/model-translations'
import { runTranslationWorker } from './article-translations'
import { blockNeedsTranslation, blockTranslationParts, hasBlockTranslation, translatePageBlock } from './universal-translation-blocks'
import type { ActorLike } from '../utils/permissions'
import { logInfo, logWarn } from '../utils/logger'
export interface UniversalCoverageStats {
  totalArticles: number
  totalBlocks: number
  totalUiKeys: number
  languages: Array<{
    code: string
    name: string
    nativeName: string
    uiMissing: number
    blocksMissing: number
    articlesMissing: number
    totalMissing: number
    percent: number
  }>
}

export interface UniversalTaskState {
  active: boolean
  phase: string
  currentItem: string
  totalItems: number
  processedItems: number
  percent: number
  targetLangs: string[]
  startedAt: string | null
  completedAt: string | null
  error: string | null
}

const universalTaskState: UniversalTaskState = {
  active: false,
  phase: 'idle',
  currentItem: '',
  totalItems: 0,
  processedItems: 0,
  percent: 0,
  targetLangs: [],
  startedAt: null,
  completedAt: null,
  error: null,
}
let cancelRequested = false

export function cancelUniversalAutoTranslate() {
  if (universalTaskState.active) {
    cancelRequested = true
    universalTaskState.phase = 'Đang dừng...'
    universalTaskState.currentItem = 'Người dùng đã yêu cầu dừng tác vụ...'
    return { ok: true, message: 'Đã yêu cầu dừng tác vụ dịch toàn cục.' }
  }
  return { ok: false, message: 'Không có tác vụ nào đang chạy.' }
}

export function getUniversalTaskState(): UniversalTaskState {
  return { ...universalTaskState }
}

/** The languages the job and the scan work on: active, vi excluded (it is the source). */
const isTargetLanguage = and(eq(languages.isActive, true), ne(languages.code, 'vi'))

/**
 * Scan translation coverage across all 3 pillars:
 * 1. UI translation keys (lang_translations)
 * 2. Page Builder blocks (page_blocks)
 * 3. Published Articles (articles & article_translations)
 *
 * Each pillar counts the work the job does (FINDING-R6-1): a translation of a draft, or
 * a key vi does not have (a deleted category's), is not progress — subtracting every
 * row showed 100 % while nothing published was translated.
 */
export async function scanUniversalCoverage(db: Database = getDb()): Promise<UniversalCoverageStats> {
  const allLangs = await db.select().from(languages).where(isTargetLanguage).orderBy(asc(languages.displayOrder), asc(languages.id))

  // 1. UI keys of the default language
  const viKeys = await db.select({ group: langTranslations.group, key: langTranslations.key }).from(langTranslations).where(eq(langTranslations.langCode, 'vi'))
  const viKeySet = new Set(viKeys.map(row => `${row.group}::${row.key}`))
  const totalUiKeys = viKeys.length

  // 2. Page blocks with something to translate (the job's own reading — FINDING-R6-2)
  const allBlocks = await db.select({ id: pageBlocks.id, data: pageBlocks.data }).from(pageBlocks).where(eq(pageBlocks.isVisible, true))
  const translatableBlocks = allBlocks.filter(b => blockTranslationParts(b.data) !== null)
  const totalBlocks = translatableBlocks.length

  // 3. Total published articles
  const [articleRow] = await db.select({ count: count() }).from(articles).where(eq(articles.status, 'published'))
  const totalArticles = Number(articleRow?.count || 0)

  const langStats: UniversalCoverageStats['languages'] = []

  for (const lang of allLangs) {
    // Missing UI keys: vi keys without text in this language
    const targetRows = await db.select({ group: langTranslations.group, key: langTranslations.key, value: langTranslations.value }).from(langTranslations).where(eq(langTranslations.langCode, lang.code))
    const translatedUi = new Set(targetRows.filter(row => row.value?.trim() && viKeySet.has(`${row.group}::${row.key}`)).map(row => `${row.group}::${row.key}`))
    const uiMissing = Math.max(0, totalUiKeys - translatedUi.size)

    // Missing Blocks
    const blocksMissing = translatableBlocks.filter(b => !hasBlockTranslation(b.data, lang.code)).length

    // Missing Articles: published ones without a translation that did not fail
    const translatedArticles = await db
      .select({ count: sql<number>`COUNT(DISTINCT ${articleTranslations.articleId})` })
      .from(articleTranslations)
      .innerJoin(articles, eq(articles.id, articleTranslations.articleId))
      .where(and(eq(articleTranslations.langCode, lang.code), sql`${articleTranslations.status} != 'failed'`, eq(articles.status, 'published')))
    const articlesMissing = Math.max(0, totalArticles - Number(translatedArticles[0]?.count || 0))

    const totalItems = totalUiKeys + totalBlocks + totalArticles
    const totalMissing = uiMissing + blocksMissing + articlesMissing
    const percent = totalItems > 0 ? Math.max(0, Math.min(100, Math.round(((totalItems - totalMissing) / totalItems) * 100))) : 100

    langStats.push({
      code: lang.code,
      name: lang.name,
      nativeName: lang.nativeName,
      uiMissing,
      blocksMissing,
      articlesMissing,
      totalMissing,
      percent,
    })
  }

  return {
    totalArticles,
    totalBlocks,
    totalUiKeys,
    languages: langStats,
  }
}

/**
 * Execute non-blocking Universal AI translation across all selected pillars.
 *
 * Only active languages other than vi are targets, whatever the request names
 * (FINDING-R6-6: vi was "translated" into Vietnamese, and a switched-off language was
 * paid for). `articlesLimit` is a whole number ≥ 0 checked by the route; 0 = every
 * published article.
 */
export async function startUniversalAutoTranslate(
  actor: ActorLike,
  targetLangs: string[],
  options: {
    includeUi?: boolean
    includeBlocks?: boolean
    includeArticles?: boolean
    articlesLimit?: number
    publishImmediately?: boolean
  } = {},
  db: Database = getDb(),
) {
  if (universalTaskState.active) {
    return { ok: false, message: 'Một tác vụ quét và dịch toàn cục đang chạy.' }
  }

  const includeUi = options.includeUi !== false
  const includeBlocks = options.includeBlocks !== false
  const includeArticles = options.includeArticles !== false
  const articlesLimit = options.articlesLimit !== undefined ? Number(options.articlesLimit) : 20
  const targetStatus = options.publishImmediately ? 'published' : 'ai_draft'
  cancelRequested = false

  universalTaskState.active = true
  universalTaskState.phase = 'Khởi động...'
  universalTaskState.currentItem = 'Đang chuẩn bị quét các mục cần dịch...'
  universalTaskState.totalItems = 100
  universalTaskState.processedItems = 0
  universalTaskState.percent = 0
  universalTaskState.targetLangs = targetLangs
  universalTaskState.startedAt = new Date().toISOString()
  universalTaskState.completedAt = null
  universalTaskState.error = null

  // Run in background
  setTimeout(async () => {
    try {
      const allLangs = await db.select().from(languages).where(and(inArray(languages.code, targetLangs), isTargetLanguage))

      // ── Step 0: Pre-calculate total items ──────────────────────────────
      let totalUiWork = 0
      let totalBlocksWork = 0
      let totalArticlesWork = 0

      if (includeUi) {
        const viRows = await db.select().from(langTranslations).where(eq(langTranslations.langCode, 'vi'))
        for (const lang of allLangs) {
          const targetRows = await db.select().from(langTranslations).where(eq(langTranslations.langCode, lang.code))
          const targetMap = new Map(targetRows.map((r) => [`${r.group}::${r.key}`, r.value]))
          const missingCount = viRows.filter((vi) => {
            const v = targetMap.get(`${vi.group}::${vi.key}`)
            return !v || !v.trim()
          }).length
          totalUiWork += Math.ceil(missingCount / 10)
        }
      }

      const blocks = includeBlocks
        ? await db.select().from(pageBlocks).where(eq(pageBlocks.isVisible, true))
        : []
      if (includeBlocks) {
        for (const lang of allLangs) {
          totalBlocksWork += blocks.filter(b => blockNeedsTranslation(b.data, lang.code)).length
        }
      }

      // Collect missing articles per language up to articlesLimit
      const missingArticlesByLang: Map<string, Array<{ id: number; title: string }>> = new Map()
      if (includeArticles) {
        for (const lang of allLangs) {
          const query = db
            .select({ id: articles.id, title: articles.title })
            .from(articles)
            .where(eq(articles.status, 'published'))
            .orderBy(desc(articles.id))
            .limit(articlesLimit > 0 ? articlesLimit : Number.MAX_SAFE_INTEGER)
          const publishedCandidates = await query

          const existingTranslations = await db
            .select({ articleId: articleTranslations.articleId })
            .from(articleTranslations)
            .where(
              and(
                eq(articleTranslations.langCode, lang.code),
                sql`${articleTranslations.status} != 'failed'`,
              ),
            )
          const existingSet = new Set(existingTranslations.map(e => e.articleId))
          const missing = publishedCandidates.filter(a => !existingSet.has(a.id))
          missingArticlesByLang.set(lang.code, missing)
          totalArticlesWork += missing.length
        }
      }

      const totalWork = totalUiWork + totalBlocksWork + totalArticlesWork
      universalTaskState.totalItems = Math.max(1, totalWork)
      universalTaskState.processedItems = 0
      universalTaskState.percent = 0

      // ── Step 1: Translate missing UI keys ──────────────────────────────
      if (includeUi) {
        universalTaskState.phase = 'Dịch các chuỗi giao diện (UI)...'
        for (const lang of allLangs) {
          if (cancelRequested) break

          const viRows = await db.select().from(langTranslations).where(eq(langTranslations.langCode, 'vi'))
          const targetRows = await db.select().from(langTranslations).where(eq(langTranslations.langCode, lang.code))
          const targetMap = new Map(targetRows.map((r) => [`${r.group}::${r.key}`, r.value]))

          const missingVi = viRows.filter((vi) => {
            const v = targetMap.get(`${vi.group}::${vi.key}`)
            return !v || !v.trim()
          })

          const CHUNK = 10
          for (let i = 0; i < missingVi.length; i += CHUNK) {
            if (cancelRequested) break
            const chunk = missingVi.slice(i, i + CHUNK)
            universalTaskState.currentItem = `Dịch UI ${lang.name}: ${chunk.map(c => c.key).slice(0, 3).join(', ')}...`

            const promptLines = chunk.map((item, idx) => `[${idx + 1}] key="${item.key}" group="${item.group}" text="${item.value || item.key}"`)
            const prompt = `Translate software UI strings to ${lang.name}. Return ONLY valid JSON array [${MODEL_TRANSLATION_ANSWER_FORMAT}] — n is the line's [n] number (a key can be in several groups):\n${promptLines.join('\n')}`

            const res = await callAi('translation_ui', { prompt, userId: actor.id ?? null })
            // Only text for keys in this chunk: stringifying the model's value stored
            // "null"/"undefined", and a key the model invented became a row under "general".
            const itemsToSave = res.ok && res.text ? readModelTranslations(res.text, chunk) : []
            if (itemsToSave.length > 0) {
              await upsertTranslations(actor, lang.code, itemsToSave, true)
            }
            universalTaskState.processedItems++
            universalTaskState.percent = Math.min(99, Math.round((universalTaskState.processedItems / universalTaskState.totalItems) * 100))
          }
        }
      }

      // ── Step 2: Translate Page Builder blocks ──────────────────────────
      if (includeBlocks && !cancelRequested) {
        universalTaskState.phase = 'Dịch các khối trang tĩnh (Trang chủ, Giới thiệu, Liên hệ...)...'

        for (const lang of allLangs) {
          if (cancelRequested) break
          for (const b of blocks) {
            if (cancelRequested) break
            if (!blockNeedsTranslation(b.data, lang.code)) continue // Already translated, or nothing to translate

            universalTaskState.currentItem = `Dịch khối ${b.blockType} (#${b.id}) sang ${lang.name}...`

            try {
              await translatePageBlock(b.id, lang, actor.id ?? null, db)
            } catch (err) {
              logWarn({ event: 'universal_translate.block_failed', blockId: b.id, langCode: lang.code, error: String(err) })
            }

            universalTaskState.processedItems++
            universalTaskState.percent = Math.min(99, Math.round((universalTaskState.processedItems / universalTaskState.totalItems) * 100))
          }
        }
      }

      // ── Step 3: Translate missing published articles ───────────────────
      if (includeArticles && !cancelRequested) {
        universalTaskState.phase = 'Dịch các bài viết...'

        for (const lang of allLangs) {
          if (cancelRequested) break
          const missing = missingArticlesByLang.get(lang.code) || []

          for (let idx = 0; idx < missing.length; idx++) {
            if (cancelRequested) break
            const art = missing[idx]!

            universalTaskState.currentItem = `Dịch bài viết (${idx + 1}/${missing.length}) "${art.title.slice(0, 32)}..." sang ${lang.name}`

            try {
              await runTranslationWorker(art.id, lang.code, lang.name, targetStatus)
            } catch (err) {
              logWarn({ event: 'universal_translate.article_failed', articleId: art.id, langCode: lang.code, error: String(err) })
            }

            universalTaskState.processedItems++
            universalTaskState.percent = Math.min(99, Math.round((universalTaskState.processedItems / universalTaskState.totalItems) * 100))
          }
        }
      }

      if (cancelRequested) {
        universalTaskState.phase = 'Đã dừng'
        universalTaskState.currentItem = 'Tác vụ đã được dừng theo yêu cầu của quản trị viên.'
        universalTaskState.active = false
        cancelRequested = false
        logInfo({ event: 'universal_translate.cancelled' })
        return
      }

      universalTaskState.phase = 'Hoàn tất'
      universalTaskState.currentItem = `Đã hoàn tất dịch thành công ${universalTaskState.processedItems} mục sang ${allLangs.length} ngôn ngữ!`
      universalTaskState.percent = 100
      universalTaskState.completedAt = new Date().toISOString()
      logInfo({ event: 'universal_translate.completed', targetLangs })
    } catch (err: unknown) {
      universalTaskState.error = err instanceof Error ? err.message : String(err)
      logWarn({ event: 'universal_translate.failed', error: universalTaskState.error })
    } finally {
      universalTaskState.active = false
      cancelRequested = false
    }
  }, 0)

  return { ok: true, message: 'Đã bắt đầu tác vụ quét và dịch toàn cục trong nền!' }
}
