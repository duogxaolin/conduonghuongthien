/**
 * Article translation service — CRUD + lifecycle management.
 *
 * All writes go through transactions with activity_logs (design.md D6).
 * Uses `articleResource(type)` + `update` for RBAC — no new resource.
 */
import { createError } from 'h3'
import { eq, and } from 'drizzle-orm'
import { getDb, type Database } from '../utils/db'
import { articleTranslations, articles, activityLogs } from '../db/schema'
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

// ─── Read ────────────────────────────────────────────────────────────────

export async function listTranslationsForArticle(articleId: number, db: Database = getDb()) {
  return db
    .select()
    .from(articleTranslations)
    .where(eq(articleTranslations.articleId, articleId))
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
  const langName = LANGUAGE_NAMES[langCode] || langCode
  setTimeout(() => {
    runTranslationWorker(articleId, langCode, langName).catch((err) => {
      logWarn({ event: 'translation.worker_unhandled_error', articleId, langCode, error: String(err) })
    })
  }, 0)

  return { ok: true }
}

// ─── Translation worker ──────────────────────────────────────────────────

async function runTranslationWorker(articleId: number, langCode: string, langName: string) {
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
      const titleExcerptPrompt = `Dịch sang ${langName}. Giữ nguyên HTML nếu có.
Trả về JSON:
{"translatedTitle":"...","translatedExcerpt":"..."}

[TIÊU ĐỀ]: ${article.title ?? ''}
[TÓM TẮT]: ${article.excerpt ?? ''}`

      const titleResult = await callAi('translation_article', {
        prompt: titleExcerptPrompt,
        userId: null,
      })

      if (titleResult.ok && titleResult.text) {
        try {
          const raw = titleResult.text.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim()
          const parsed = JSON.parse(raw) as { translatedTitle?: string; translatedExcerpt?: string }
          translatedTitle = parsed.translatedTitle || ''
          translatedExcerpt = parsed.translatedExcerpt || ''
        } catch {
          translatedTitle = titleResult.text.trim()
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
        status: 'ai_draft',
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
      const chunk = chunks[i]
      const chunkPrompt = `Dịch đoạn ${i + 1}/${totalChunks} của một bài viết sang ${langName}.
Yêu cầu:
1. Chuẩn xác thuật ngữ pháp lý và hành chính.
2. Giữ nguyên 100% các thẻ HTML (<p>, <strong>, <em>, <a>, <img>, <ul>, <ol>, <li>, <h2>, <h3>, <table>...) — chỉ dịch phần văn bản bên trong.
3. Giữ nguyên cấu trúc HTML.

[NỘI DUNG GỐC]:
${chunk.html}`

      const chunkResult = await callAi('translation_article', {
        prompt: chunkPrompt,
        userId: null,
      })

      if (!chunkResult.ok || !chunkResult.text) {
        // Save partial and mark failed
        await updateTranslationStatus(db, articleId, langCode, {
          status: 'failed',
          errorMessage: `Lỗi dịch đoạn ${i + 1}/${totalChunks}: ${chunkResult.errorMessage || 'AI không phản hồi.'}`,
          currentChunk: i,
          progress: 10 + Math.round((i / totalChunks) * 90),
          content: translatedChunks.join(''),
        })
        logWarn({ event: 'translation.chunk_failed', articleId, langCode, chunk: i + 1, total: totalChunks })
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
        status: 'ai_draft',
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
  db: Database = getDb(),
) {
  // Verify all articles exist and actor has permission
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
    runBulkTranslation(articleIds, langCode, langName).catch((err) => {
      logWarn({ event: 'translation.bulk_worker_unhandled_error', error: String(err) })
    })
  }, 0)

  return { ok: true, count: articleIds.length }
}

async function runBulkTranslation(articleIds: number[], langCode: string, langName: string) {
  for (const articleId of articleIds) {
    try {
      const db = getDb()
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

      await runTranslationWorker(articleId, langCode, langName)
    } catch (err) {
      logWarn({ event: 'translation.bulk_item_failed', articleId, langCode, error: String(err) })
    }
  }
}
