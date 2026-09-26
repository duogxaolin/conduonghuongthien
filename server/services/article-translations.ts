/**
 * Article translation service — CRUD + lifecycle management.
 *
 * All writes go through transactions with activity_logs (design.md D6).
 * Uses `articleResource(type)` + `update` for RBAC — no new resource.
 */
import { createError } from 'h3'
import { eq, and, sql } from 'drizzle-orm'
import { getDb, type Database } from '../utils/db'
import { articleTranslations, articles, activityLogs, languages } from '../db/schema'
import { type ActorLike } from '../utils/permissions'
import { articleResource } from './articles'
import { chunkHtml } from '../utils/html-chunker'
import { callAi } from './ai-gateway'
import { checkBudget } from '../utils/ai-budget'
import { logInfo, logWarn } from '../utils/logger'

export const TRANSLATION_STATUSES = [
  'translating', 'ai_draft', 'reviewed', 'published', 'failed',
] as const
export type TranslationStatus = (typeof TRANSLATION_STATUSES)[number]

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  zh: 'Chinese (中文)',
  fr: 'French (Français)',
  ru: 'Russian (Русский)',
  ja: 'Japanese (日本語)',
  ko: 'Korean (한국어)',
  lo: 'Lao',
  km: 'Khmer',
}
function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}

// ─── Read ────────────────────────────────────────────────────────────────

export function parseTitleAndExcerpt(
  rawText: string,
  originalTitle = '',
  originalExcerpt = '',
): { title: string; excerpt: string } {
  let title = ''
  let excerpt = ''

  if (!rawText || !rawText.trim()) {
    return { title: '', excerpt: '' }
  }

  // Strategy 1: Find a JSON object inside the text (handling markdown fences or embedded JSON)
  const jsonMatch = rawText.match(/\{[\s\S]*?"translatedTitle"[\s\S]*?\}/)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as { translatedTitle?: string; translatedExcerpt?: string }
      if (parsed.translatedTitle && parsed.translatedTitle !== '...') {
        title = String(parsed.translatedTitle).trim()
      }
      if (parsed.translatedExcerpt && parsed.translatedExcerpt !== '...') {
        excerpt = String(parsed.translatedExcerpt).trim()
      }
    } catch {
      // Fall through to regex extraction
    }
  }

  // Strategy 2: Extract from tags like [TITLE] / [EXCERPT]
  if (!title) {
    const titleMatch = rawText.match(
      /(?:\[TITLE\]|\[TIÊU ĐỀ\]|Title:)\s*([^\n\r]+(?:\n[^\n\r\[]+)*?)(?=\s*\[(?:EXCERPT|TÓM TẮT)\]|\s*Excerpt:|$)/i,
    )
    if (titleMatch && titleMatch[1]) {
      title = titleMatch[1].trim()
    }
  }

  if (!excerpt) {
    const excerptMatch = rawText.match(/(?:\[EXCERPT\]|\[TÓM TẮT\]|Excerpt:)\s*([\s\S]+?)$/i)
    if (excerptMatch && excerptMatch[1]) {
      excerpt = excerptMatch[1].trim()
    }
  }

  // Strategy 3: Clean prompt artifacts if instructions were echoed
  if (title) {
    title = title
      .replace(/^[\s\S]*?\[(?:TITLE|TIÊU ĐỀ)\]:\s*/i, '')
      .replace(/^Keep HTML if present\.\s*/gi, '')
      .replace(/^Return JSON:[\s\S]*?\{[\s\S]*?\}\s*/gi, '')
      .replace(/\[(?:EXCERPT|TÓM TẮT)\]:[\s\S]*$/i, '')
      .replace(/^[:\s\-]+/, '')
      .replace(/^["']|["']$/g, '')
      .trim()
  }

  if (excerpt) {
    excerpt = excerpt
      .replace(/^[\s\S]*?\[(?:EXCERPT|TÓM TẮT)\]:\s*/i, '')
      .replace(/^[:\s\-]+/, '')
      .replace(/^["']|["']$/g, '')
      .trim()
  }

  // Fallback if title still looks empty or has instruction remnants
  if (!title && originalTitle) {
    const cleanLines = rawText
      .split('\n')
      .map((l) => l.trim())
      .filter(
        (l) =>
          l &&
          !l.startsWith('{') &&
          !l.startsWith('}') &&
          !l.includes('Return JSON') &&
          !l.includes('Keep HTML') &&
          !l.includes('translatedTitle'),
      )
    title = cleanLines[0]?.replace(/^[:\s\-]+/, '') || ''
  }

  return { title, excerpt }
}

export async function listTranslationsForArticle(articleId: number, db: Database = getDb()) {
  const rows = await db
    .select()
    .from(articleTranslations)
    .where(eq(articleTranslations.articleId, articleId))

  // Auto-heal any contaminated title/excerpt on the fly
  for (const row of rows) {
    if (
      row.title &&
      (row.title.includes('Keep HTML') ||
        row.title.includes('Return JSON') ||
        row.title.includes('[TITLE]:') ||
        row.title.includes('[TIÊU ĐỀ]:') ||
        row.title.includes('translatedTitle'))
    ) {
      const fixed = parseTitleAndExcerpt(row.title)
      if (fixed.title) {
        row.title = fixed.title
        if (!row.excerpt && fixed.excerpt) {
          row.excerpt = fixed.excerpt
        }
        // Asynchronously persist clean values
        db.update(articleTranslations)
          .set({ title: row.title, excerpt: row.excerpt })
          .where(eq(articleTranslations.id, row.id))
          .catch(() => {})
      }
    }
  }

  return rows
}

export async function getTranslationProgress(
  articleId: number,
  langCode: string,
  db: Database = getDb(),
) {
  const [row] = await db
    .select()
    .from(articleTranslations)
    .where(
      and(
        eq(articleTranslations.articleId, articleId),
        eq(articleTranslations.langCode, langCode),
      ),
    )
    .limit(1)

  if (!row) return null
  return {
    status: row.status,
    progress: row.progress,
    currentChunk: row.currentChunk,
    totalChunks: row.totalChunks,
    errorMessage: row.errorMessage,
    completedAt: row.completedAt,
  }
}

// ─── Create (trigger translation worker) ─────────────────────────────────

export async function triggerTranslation(
  actor: ActorLike,
  articleId: number,
  langCode: string,
  targetStatus: 'ai_draft' | 'published' = 'ai_draft',
  db: Database = getDb(),
) {
  // Check article exists and get type for RBAC
  const [article] = await db.select().from(articles).where(eq(articles.id, articleId)).limit(1)
  if (!article) {
    throw createError({ statusCode: 404, statusMessage: 'Bài viết không tồn tại.' })
  }

  // RBAC
  const { requireResourcePermission } = await import('../utils/permissions')
  requireResourcePermission(actor, articleResource(article.type), 'update')

  // Check for existing translation
  const [existing] = await db
    .select()
    .from(articleTranslations)
    .where(
      and(
        eq(articleTranslations.articleId, articleId),
        eq(articleTranslations.langCode, langCode),
      ),
    )
    .limit(1)

  if (existing && existing.status === 'translating') {
    throw createError({ statusCode: 409, statusMessage: 'Bản dịch đang được tạo, vui lòng đợi.' })
  }

  // Upsert translation row with status='translating'
  if (existing) {
    await db
      .update(articleTranslations)
      .set({
        status: 'translating',
        progress: 0,
        currentChunk: 0,
        totalChunks: 0,
        errorMessage: null,
        completedAt: null,
      })
      .where(eq(articleTranslations.id, existing.id))
  } else {
    await db.insert(articleTranslations).values({
      articleId,
      langCode,
      status: 'translating',
      translatedBy: 'ai',
    })
  }

  // Audit
  await db.insert(activityLogs).values({
    userId: actor.id ?? null,
    action: 'create',
    resource: 'settings',
    resourceId: articleId,
    meta: { operation: 'create_article_translation', articleId, langCode, translatedBy: 'ai' },
  })

  // Spawn background worker (non-blocking)
  const [langRecord] = await db
    .select({ name: languages.name })
    .from(languages)
    .where(eq(languages.code, langCode))
    .limit(1)
  const langName = langRecord?.name || LANGUAGE_NAMES[langCode] || langCode

  setTimeout(() => {
    runTranslationWorker(articleId, langCode, langName, targetStatus).catch((err) => {
      logWarn({ event: 'translation.worker_unhandled_error', articleId, langCode, error: String(err) })
    })
  }, 0)
  return { ok: true }
}

export async function triggerTranslateAllLanguages(
  actor: ActorLike,
  articleId: number,
  targetStatus: 'ai_draft' | 'published' = 'ai_draft',
  db: Database = getDb(),
) {
  const [article] = await db.select({ id: articles.id }).from(articles).where(eq(articles.id, articleId)).limit(1)
  if (!article) {
    throw createError({ statusCode: 404, statusMessage: 'Bài viết không tồn tại.' })
  }

  const activeLangs = await db
    .select({ code: languages.code, name: languages.name })
    .from(languages)
    .where(and(eq(languages.isActive, true), sql`${languages.code} != 'vi'`))

  const existing = await db
    .select({ langCode: articleTranslations.langCode, status: articleTranslations.status })
    .from(articleTranslations)
    .where(eq(articleTranslations.articleId, articleId))

  const existingMap = new Map(existing.map((e) => [e.langCode, e.status]))
  const toTranslate = activeLangs.filter((l) => {
    const status = existingMap.get(l.code)
    return !status || status === 'failed'
  })

  for (const l of toTranslate) {
    await triggerTranslation(actor, articleId, l.code, targetStatus, db)
  }
  return { queued: toTranslate.length, languages: toTranslate.map((l) => l.code) }
}

// ─── Translation worker ──────────────────────────────────────────────────

export async function runTranslationWorker(
  articleId: number,
  langCode: string,
  langName: string,
  targetStatus: 'ai_draft' | 'published' = 'ai_draft',
) {
  const db = getDb()
  logInfo({ event: 'translation.job_started', articleId, langCode })
  try {
    // Fetch article content
    const [article] = await db.select().from(articles).where(eq(articles.id, articleId)).limit(1)
    if (!article) {
      await updateTranslationStatus(db, articleId, langCode, {
        status: 'failed',
        errorMessage: 'Bài viết không tồn tại.',
      })
      return
    }

    // Budget check
    const budgetResult = await checkBudget(db, 'translation_article')
    if (!budgetResult.allowed) {
      await updateTranslationStatus(db, articleId, langCode, {
        status: 'failed',
        errorMessage: 'Ngân sách AI đã hết.',
      })
      return
    }

    // Translate title + excerpt (single call)
    await updateTranslationStatus(db, articleId, langCode, { progress: 0 })

    let translatedTitle = ''
    let translatedExcerpt = ''

    if (article.title || article.excerpt) {
      const titlePrompt = `Bạn là biên dịch viên báo chí chuyên nghiệp.
Hãy dịch chính xác tiêu đề và đoạn tóm tắt bài viết sau sang ${langName}.
YÊU CẦU BẮT BUỘC:
1. Văn phong báo chí trang trọng, chính xác.
2. CHỈ TRẢ VỀ DUY NHẤT một JSON object hợp lệ theo định dạng:
{"translatedTitle": "tiêu đề đã dịch", "translatedExcerpt": "tóm tắt đã dịch"}
3. TUYỆT ĐỐI KHÔNG lặp lại đề bài, không dịch câu lệnh, không thêm markdown ngoài JSON.

TIÊU ĐỀ GỐC:
${article.title ?? ''}

TÓM TẮT GỐC:
${article.excerpt ?? ''}`

      let titleResult = null
      for (let attempt = 1; attempt <= 3; attempt++) {
        titleResult = await callAi('translation_article', {
          prompt: titlePrompt,
          userId: null,
        })
        if (titleResult.ok && titleResult.text) break
        if (attempt < 3) {
          logWarn({ event: 'translation.title_retry', articleId, langCode, attempt })
          await delay(attempt * 1500)
        }
      }

      if (titleResult?.ok && titleResult?.text) {
        const parsed = parseTitleAndExcerpt(titleResult.text, article.title || '', article.excerpt || '')
        translatedTitle = parsed.title
        translatedExcerpt = parsed.excerpt
      }

      // Safe fallback: if title is still missing while original exists
      if (!translatedTitle && article.title) {
        try {
          const directTitleRes = await callAi('translation_article', {
            prompt: `Dịch tiêu đề tin tức sau sang ${langName}. CHỈ TRẢ VỀ DUY NHẤT BẢN DỊCH, không thêm dấu ngoặc kép hay giải thích:\n\n${article.title}`,
            userId: null,
          })
          if (directTitleRes.ok && directTitleRes.text) {
            translatedTitle = directTitleRes.text.trim().replace(/^["']|["']$/g, '')
          }
        } catch {
          // Keep whatever we have
        }
      }

      // Safe fallback: if excerpt is still missing while original exists
      if (!translatedExcerpt && article.excerpt) {
        try {
          const directExcerptRes = await callAi('translation_article', {
            prompt: `Dịch đoạn tóm tắt tin tức sau sang ${langName}. CHỈ TRẢ VỀ DUY NHẤT BẢN DỊCH, không thêm dấu ngoặc kép hay giải thích:\n\n${article.excerpt}`,
            userId: null,
          })
          if (directExcerptRes.ok && directExcerptRes.text) {
            translatedExcerpt = directExcerptRes.text.trim().replace(/^["']|["']$/g, '')
          }
        } catch {
          // Keep whatever we have
        }
      }
    }
    await updateTranslationStatus(db, articleId, langCode, {
      progress: 10,
      title: translatedTitle,
      excerpt: translatedExcerpt,
    })

    // Chunk and translate content
    const content = article.content ?? ''
    if (!content.trim()) {
      // No content — just save title + excerpt
      await updateTranslationStatus(db, articleId, langCode, {
        status: targetStatus,
        progress: 100,
        totalChunks: 0,
        currentChunk: 0,
        completedAt: new Date(),
      })
      logInfo({ event: 'translation.job_completed', articleId, langCode, totalChunks: 0 })
      return
    }

    const chunks = chunkHtml(content)
    const totalChunks = chunks.length

    await updateTranslationStatus(db, articleId, langCode, {
      totalChunks,
      currentChunk: 0,
      progress: 10,
    })

    const translatedChunks: string[] = []

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!
      const chunkPrompt = `Dịch đoạn ${i + 1}/${totalChunks} của một bài viết sang ${langName}.
Yêu cầu:
1. Chuẩn xác thuật ngữ pháp lý và hành chính.
2. Giữ nguyên 100% các thẻ HTML (<p>, <strong>, <em>, <a>, <img>, <ul>, <ol>, <li>, <h2>, <h3>, <table>...) — chỉ dịch phần văn bản bên trong.
3. Giữ nguyên cấu trúc HTML.

[NỘI DUNG GỐC]:
${chunk.html}`

      let chunkResult = null
      let attempts = 0
      const MAX_RETRIES = 3
      while (attempts < MAX_RETRIES) {
        attempts++
        chunkResult = await callAi('translation_article', {
          prompt: chunkPrompt,
          userId: null,
        })
        if (chunkResult.ok && chunkResult.text) break

        if (attempts < MAX_RETRIES) {
          logWarn({ event: 'translation.chunk_retry', articleId, langCode, chunk: i + 1, attempt: attempts })
          await delay(attempts * 2000)
        }
      }

      if (!chunkResult?.ok || !chunkResult?.text) {
        // Save partial and mark failed after 3 retries
        await updateTranslationStatus(db, articleId, langCode, {
          status: 'failed',
          errorMessage: `Lỗi dịch đoạn ${i + 1}/${totalChunks} (đã thử lại ${MAX_RETRIES} lần): ${chunkResult?.errorMessage || 'AI không phản hồi.'}`,
          currentChunk: i,
          progress: 10 + Math.round((i / totalChunks) * 90),
          content: translatedChunks.join(''),
        })
        logWarn({ event: 'translation.chunk_failed_after_retries', articleId, langCode, chunk: i + 1, total: totalChunks })
        return
      }

      translatedChunks.push(chunkResult.text.trim())

      const progress = 10 + Math.round(((i + 1) / totalChunks) * 90)
      await updateTranslationStatus(db, articleId, langCode, {
        currentChunk: i + 1,
        progress,
      })

      logInfo({ event: 'translation.chunk_completed', articleId, langCode, chunk: i + 1, total: totalChunks })
    }

    // All chunks done — assemble and save
    await db
      .update(articleTranslations)
      .set({
        content: translatedChunks.join(''),
        status: targetStatus,
        progress: 100,
        currentChunk: totalChunks,
        completedAt: new Date(),
      })
      .where(
        and(
          eq(articleTranslations.articleId, articleId),
          eq(articleTranslations.langCode, langCode),
        ),
      )

    logInfo({ event: 'translation.job_completed', articleId, langCode, totalChunks })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await updateTranslationStatus(db, articleId, langCode, {
      status: 'failed',
      errorMessage: message.slice(0, 512),
    })
    logWarn({ event: 'translation.job_failed', articleId, langCode, error: message })
  }
}

async function updateTranslationStatus(
  db: Database,
  articleId: number,
  langCode: string,
  updates: Partial<{
    status: string
    progress: number
    currentChunk: number
    totalChunks: number
    errorMessage: string | null
    completedAt: Date
    title: string
    excerpt: string
    content: string
  }>,
) {
  await db
    .update(articleTranslations)
    .set(updates)
    .where(
      and(
        eq(articleTranslations.articleId, articleId),
        eq(articleTranslations.langCode, langCode),
      ),
    )
}

// ─── Manual update (admin edits) ──────────────────────────────────────────

export async function updateTranslation(
  actor: ActorLike,
  articleId: number,
  langCode: string,
  data: { title?: string; excerpt?: string; content?: string },
  db: Database = getDb(),
) {
  const [article] = await db.select().from(articles).where(eq(articles.id, articleId)).limit(1)
  if (!article) {
    throw createError({ statusCode: 404, statusMessage: 'Bài viết không tồn tại.' })
  }

  const { requireResourcePermission } = await import('../utils/permissions')
  requireResourcePermission(actor, articleResource(article.type), 'update')

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(articleTranslations)
      .where(
        and(
          eq(articleTranslations.articleId, articleId),
          eq(articleTranslations.langCode, langCode),
        ),
      )
      .limit(1)

    if (!existing) {
      throw createError({ statusCode: 404, statusMessage: 'Bản dịch không tồn tại.' })
    }

    const updates: Record<string, unknown> = {
      translatedBy: 'human',
      translatorId: actor.id ?? null,
      status: 'reviewed',
    }
    if (data.title !== undefined) updates.title = data.title
    if (data.excerpt !== undefined) updates.excerpt = data.excerpt
    if (data.content !== undefined) updates.content = data.content

    await tx
      .update(articleTranslations)
      .set(updates)
      .where(eq(articleTranslations.id, existing.id))

    await tx.insert(activityLogs).values({
      userId: actor.id ?? null,
      action: 'update',
      resource: 'settings',
      resourceId: articleId,
      meta: { operation: 'update_article_translation', articleId, langCode },
    })
  })
}

// ─── Status change (publish/unpublish) ────────────────────────────────────

export async function setTranslationStatus(
  actor: ActorLike,
  articleId: number,
  langCode: string,
  status: 'published' | 'reviewed' | 'ai_draft',
  db: Database = getDb(),
) {
  const [article] = await db.select().from(articles).where(eq(articles.id, articleId)).limit(1)
  if (!article) {
    throw createError({ statusCode: 404, statusMessage: 'Bài viết không tồn tại.' })
  }

  const { requireResourcePermission } = await import('../utils/permissions')
  requireResourcePermission(actor, articleResource(article.type), 'update')

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(articleTranslations)
      .where(
        and(
          eq(articleTranslations.articleId, articleId),
          eq(articleTranslations.langCode, langCode),
        ),
      )
      .limit(1)

    if (!existing) {
      throw createError({ statusCode: 404, statusMessage: 'Bản dịch không tồn tại.' })
    }

    // Cannot publish if title/content is null (still translating or failed)
    if (status === 'published') {
      if (existing.status === 'translating') {
        throw createError({ statusCode: 400, statusMessage: 'Bản dịch đang được tạo.' })
      }
      if (existing.status === 'failed') {
        throw createError({ statusCode: 400, statusMessage: 'Bản dịch bị lỗi, không thể xuất bản.' })
      }
    }

    await tx
      .update(articleTranslations)
      .set({ status })
      .where(eq(articleTranslations.id, existing.id))

    await tx.insert(activityLogs).values({
      userId: actor.id ?? null,
      action: 'update',
      resource: 'settings',
      resourceId: articleId,
      meta: { operation: 'change_article_translation_status', articleId, langCode, newStatus: status },
    })
  })
}

// ─── Delete ───────────────────────────────────────────────────────────────

export async function deleteTranslation(
  actor: ActorLike,
  articleId: number,
  langCode: string,
  db: Database = getDb(),
) {
  const [article] = await db.select().from(articles).where(eq(articles.id, articleId)).limit(1)
  if (!article) {
    throw createError({ statusCode: 404, statusMessage: 'Bài viết không tồn tại.' })
  }

  const { requireResourcePermission } = await import('../utils/permissions')
  requireResourcePermission(actor, articleResource(article.type), 'update')

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(articleTranslations)
      .where(
        and(
          eq(articleTranslations.articleId, articleId),
          eq(articleTranslations.langCode, langCode),
        ),
      )
      .limit(1)

    if (!existing) {
      throw createError({ statusCode: 404, statusMessage: 'Bản dịch không tồn tại.' })
    }

    await tx
      .delete(articleTranslations)
      .where(eq(articleTranslations.id, existing.id))

    await tx.insert(activityLogs).values({
      userId: actor.id ?? null,
      action: 'delete',
      resource: 'settings',
      resourceId: articleId,
      meta: { operation: 'delete_article_translation', articleId, langCode },
    })
  })
}

// ─── Bulk translate ──────────────────────────────────────────────────────

export async function bulkTriggerTranslation(
  actor: ActorLike,
  articleIds: number[],
  langCode: string,
  targetStatus: 'ai_draft' | 'published' = 'ai_draft',
  db: Database = getDb(),
) {
  for (const id of articleIds) {
    const [article] = await db.select().from(articles).where(eq(articles.id, id)).limit(1)
    if (!article) continue
    const { requireResourcePermission } = await import('../utils/permissions')
    requireResourcePermission(actor, articleResource(article.type), 'update')
  }

  // Audit
  await db.insert(activityLogs).values({
    userId: actor.id ?? null,
    action: 'update',
    resource: 'settings',
    meta: { operation: 'bulk_translate_articles', langCode, count: articleIds.length, articleIds },
  })

  // Trigger translations sequentially in background
  const langName = LANGUAGE_NAMES[langCode] || langCode
  setTimeout(() => {
    runBulkTranslation(articleIds, langCode, langName, targetStatus).catch((err) => {
      logWarn({ event: 'translation.bulk_worker_unhandled_error', error: String(err) })
    })
  }, 0)

  return { ok: true, count: articleIds.length }
}
export interface BulkTranslationTaskState {
  active: boolean
  total: number
  processed: number
  currentArticleId: number | null
  currentArticleTitle: string | null
  langCode: string
  langName: string
  startedAt: string | null
  completedAt: string | null
}

const bulkTaskState: BulkTranslationTaskState = {
  active: false,
  total: 0,
  processed: 0,
  currentArticleId: null,
  currentArticleTitle: null,
  langCode: '',
  langName: '',
  startedAt: null,
  completedAt: null,
}

export function getBulkTranslationTaskState(): BulkTranslationTaskState {
  return { ...bulkTaskState }
}

async function runBulkTranslation(
  articleIds: number[],
  langCode: string,
  langName: string,
  targetStatus: 'ai_draft' | 'published' = 'ai_draft',
) {
  bulkTaskState.total = articleIds.length
  bulkTaskState.processed = 0
  bulkTaskState.langCode = langCode
  bulkTaskState.langName = langName
  bulkTaskState.startedAt = new Date().toISOString()
  bulkTaskState.completedAt = null

  try {
    for (let idx = 0; idx < articleIds.length; idx++) {
      const articleId = articleIds[idx]!
      try {
        const db = getDb()
        const [article] = await db
          .select({ title: articles.title })
          .from(articles)
          .where(eq(articles.id, articleId))
          .limit(1)

        bulkTaskState.currentArticleId = articleId
        bulkTaskState.currentArticleTitle = article?.title || null
        bulkTaskState.processed = idx + 1

        // Skip if already translating or has a completed translation
        const [existing] = await db
          .select()
          .from(articleTranslations)
          .where(
            and(
              eq(articleTranslations.articleId, articleId),
              eq(articleTranslations.langCode, langCode),
            ),
          )
          .limit(1)

        if (existing && (existing.status === 'translating' || existing.status === 'published')) {
          continue
        }

        // Upsert to translating
        if (existing) {
          await db
            .update(articleTranslations)
            .set({
              status: 'translating',
              progress: 0,
              currentChunk: 0,
              totalChunks: 0,
              errorMessage: null,
              completedAt: null,
            })
            .where(eq(articleTranslations.id, existing.id))
        } else {
          await db.insert(articleTranslations).values({
            articleId,
            langCode,
            status: 'translating',
            translatedBy: 'ai',
          })
        }
        await runTranslationWorker(articleId, langCode, langName, targetStatus)
      } catch (err) {
        logWarn({ event: 'translation.bulk_item_failed', articleId, langCode, error: String(err) })
      }
    }
  } finally {
    bulkTaskState.active = false
    bulkTaskState.completedAt = new Date().toISOString()
    bulkTaskState.currentArticleId = null
    bulkTaskState.currentArticleTitle = null
  }
}
