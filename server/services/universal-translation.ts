import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { getDb, type Database } from '../utils/db'
import { articles, articleTranslations, languages, langTranslations, pageBlocks, pages } from '../db/schema'
import { callAi } from './ai-gateway'
import { upsertTranslations } from './languages'
import { runTranslationWorker } from './article-translations'
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

/**
 * Scan translation coverage across all 3 pillars:
 * 1. UI translation keys (lang_translations)
 * 2. Page Builder blocks (page_blocks)
 * 3. Published Articles (articles & article_translations)
 */
export async function scanUniversalCoverage(db: Database = getDb()): Promise<UniversalCoverageStats> {
  const allLangs = await db.select().from(languages).where(and(eq(languages.isActive, true), sql`${languages.code} != 'vi'`)).orderBy(asc(languages.displayOrder), asc(languages.id))

  // 1. Total UI keys in default language
  const [viKeyRow] = await db.select({ count: count() }).from(langTranslations).where(eq(langTranslations.langCode, 'vi'))
  const totalUiKeys = Number(viKeyRow?.count || 0)

  // 2. Total Page blocks
  const allBlocks = await db.select({ id: pageBlocks.id, data: pageBlocks.data, blockType: pageBlocks.blockType }).from(pageBlocks).where(eq(pageBlocks.isVisible, true))
  const translatableBlocks = allBlocks.filter((b) => {
    const d = (b.data as Record<string, unknown>) || {}
    return Boolean(d.text || d.title || d.heading || d.subtitle || d.bodyHtml || d.description)
  })
  const totalBlocks = translatableBlocks.length

  // 3. Total published articles
  const [articleRow] = await db.select({ count: count() }).from(articles).where(eq(articles.status, 'published'))
  const totalArticles = Number(articleRow?.count || 0)

  const langStats: UniversalCoverageStats['languages'] = []

  for (const lang of allLangs) {
    // Missing UI keys
    const translatedUi = await db
      .select({ count: count() })
      .from(langTranslations)
      .where(and(eq(langTranslations.langCode, lang.code), sql`${langTranslations.value} IS NOT NULL AND TRIM(${langTranslations.value}) != ''`))
    const uiMissing = Math.max(0, totalUiKeys - Number(translatedUi[0]?.count || 0))

    // Missing Blocks
    let blocksMissing = 0
    for (const b of translatableBlocks) {
      const d = (b.data as Record<string, unknown>) || {}
      const translations = (d.translations as Record<string, Record<string, unknown>> | undefined)?.[lang.code]
      if (!translations || Object.keys(translations).length === 0) {
        blocksMissing++
      }
    }

    // Missing Articles
    const translatedArticles = await db
      .select({ count: count() })
      .from(articleTranslations)
      .where(and(eq(articleTranslations.langCode, lang.code), sql`${articleTranslations.status} != 'failed'`))
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
      const allLangs = await db.select().from(languages).where(inArray(languages.code, targetLangs))

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
          for (const b of blocks) {
            const rawData = (b.data as Record<string, unknown>) || {}
            const translations = (rawData.translations as Record<string, Record<string, unknown>> | undefined) || {}
            if (!translations[lang.code] || Object.keys(translations[lang.code]!).length === 0) {
              totalBlocksWork++
            }
          }
        }
      }

      // Collect missing articles per language up to articlesLimit
      const missingArticlesByLang: Map<string, Array<{ id: number; title: string }>> = new Map()
      if (includeArticles) {
        for (const lang of allLangs) {
          let query = db
            .select({ id: articles.id, title: articles.title })
            .from(articles)
            .where(eq(articles.status, 'published'))
            .orderBy(desc(articles.id))
          if (articlesLimit > 0) {
            query = query.limit(articlesLimit)
          }
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
            const prompt = `Translate software UI strings to ${lang.name}. Return ONLY valid JSON array [{"key":"...", "value":"..."}]:\n${promptLines.join('\n')}`

            const res = await callAi('translation_ui', { prompt, userId: actor.id ?? null })
            if (res.ok && res.text) {
              try {
                const raw = res.text.replace(/```json\s*/gi, '').replace(/```\s*$/g, '').trim()
                const parsed = JSON.parse(raw) as Array<{ key: string; value: string }>
                const itemsToSave = parsed.map((p) => {
                  const m = chunk.find(c => c.key === p.key)
                  return { group: m?.group || 'general', key: p.key, value: String(p.value).trim() }
                })
                if (itemsToSave.length > 0) {
                  await upsertTranslations(actor, lang.code, itemsToSave, true)
                }
              } catch {}
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
            const rawData = (b.data as Record<string, unknown>) || {}
            const translations = (rawData.translations as Record<string, Record<string, unknown>> | undefined) || {}
            if (translations[lang.code] && Object.keys(translations[lang.code]!).length > 0) {
              continue // Already translated
            }

            // Extract translatable text fields
            const fieldsToTranslate: Record<string, string> = {}
            for (const key of ['title', 'subtitle', 'heading', 'text', 'description', 'asideTitle', 'asideSubtitle', 'asideNote', 'asideLabel', 'badge', 'btnText', 'buttonText']) {
              if (typeof rawData[key] === 'string' && (rawData[key] as string).trim()) {
                fieldsToTranslate[key] = (rawData[key] as string).trim()
              }
            }

            if (Object.keys(fieldsToTranslate).length === 0 && !rawData.bodyHtml) continue

            universalTaskState.currentItem = `Dịch khối ${b.blockType} (#${b.id}) sang ${lang.name}...`

            const prompt = `Translate the following CMS page block into ${lang.name}.
Keep HTML structure intact if present.
Return ONLY valid JSON with the same keys and translated text values:
${JSON.stringify({ ...fieldsToTranslate, ...(rawData.bodyHtml ? { bodyHtml: rawData.bodyHtml } : {}) })}`

            const res = await callAi('translation_article', { prompt, userId: actor.id ?? null })
            if (res.ok && res.text) {
              try {
                const raw = res.text.replace(/```json\s*/gi, '').replace(/```\s*$/g, '').trim()
                const parsed = JSON.parse(raw) as Record<string, unknown>
                if (parsed && typeof parsed === 'object') {
                  const updatedData = {
                    ...rawData,
                    translations: {
                      ...translations,
                      [lang.code]: parsed,
                    },
                  }
                  await db.update(pageBlocks).set({ data: updatedData }).where(eq(pageBlocks.id, b.id))
                }
              } catch {}
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
      universalTaskState.currentItem = `Đã hoàn tất dịch thành công ${universalTaskState.processedItems} mục sang ${targetLangs.length} ngôn ngữ!`
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
