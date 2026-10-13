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
import { sanitizeHtml } from '../utils/sanitize-html'
import { stripMarkup } from '../utils/translation-html'
import { LANGUAGE_NAMES, parseTitleAndExcerpt, runTranslationWorker } from './article-translation-worker'

// Worker (job dịch) và bulk (dịch hàng loạt) đã tách file; re-export để mọi import cũ
// từ './article-translations' (endpoint, universal-translation, test) không đổi.
export { parseTitleAndExcerpt, runTranslationWorker } from './article-translation-worker'
export {
  bulkTriggerTranslation,
  getBulkTranslationTaskState,
  type BulkTranslationTaskState,
} from './article-translation-bulk'

export const TRANSLATION_STATUSES = [
  'translating', 'ai_draft', 'reviewed', 'published', 'failed',
] as const
export type TranslationStatus = (typeof TRANSLATION_STATUSES)[number]


// ─── Read ────────────────────────────────────────────────────────────────


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
    if (data.title !== undefined) updates.title = stripMarkup(data.title)
    if (data.excerpt !== undefined) updates.excerpt = stripMarkup(data.excerpt)
    if (data.content !== undefined) updates.content = sanitizeHtml(data.content)

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

/**
 * Xuất bản toàn bộ bản dịch AI chưa xuất bản. Chuyển `ai_draft`/`reviewed` sang
 * `published`; bỏ qua `translating` (chưa xong) và `failed` (không covert得起)
 * để không phá dòng đang chạy. Tuỳ chọn lọc theo `langCode`.
 *
 * Mỗi bản cập nhật state trong transaction với activity_logs (design.md D6).
 * Trả về số bản đã xuất bản + số bị bỏ qua kèm lý do để UI hiển thị.
 */
export async function bulkPublishAiTranslations(
  actor: ActorLike,
  langCode: string | null,
  db: Database = getDb(),
): Promise<{ published: number; skipped: number; skippedTranslating: number; skippedFailed: number }> {
  const where = and(
    eq(articleTranslations.translatedBy, 'ai'),
    sql`${articleTranslations.status} IN ('ai_draft','reviewed')`,
    langCode ? eq(articleTranslations.langCode, langCode.toLowerCase()) : sql`1=1`,
  )

  const rows = await db
    .select({
      id: articleTranslations.id,
      articleId: articleTranslations.articleId,
      langCode: articleTranslations.langCode,
      status: articleTranslations.status,
    })
    .from(articleTranslations)
    .where(where)

  if (rows.length === 0) {
    return { published: 0, skipped: 0, skippedTranslating: 0, skippedFailed: 0 }
  }

  // Kiểm tra quyền trên từng article type — không publish nếu admin thiếu update
  // trên resource đó. Gom theo type để check 1 lần/type.
  const articleIds = Array.from(new Set(rows.map((r) => r.articleId)))
  const articleRows = await db
    .select({ id: articles.id, type: articles.type })
    .from(articles)
    .where(sql`${articles.id} IN (${articleIds.join(',')})`)
  const typeById = new Map(articleRows.map((a) => [a.id, a.type]))

  const { requireResourcePermission } = await import('../utils/permissions')
  const allowed = new Set<string>()
  for (const art of articleRows) {
    const key = `${art.type}`
    if (allowed.has(key)) continue
    requireResourcePermission(actor, articleResource(art.type), 'update')
    allowed.add(key)
  }

  // Lọc ra những row hợp lệ để publish (article còn tồn tại + status không phải
  // translating/failed — đã lọc ở WHERE, nhưng check lại phòng race).
  const toPublish = rows.filter((r) => {
    const type = typeById.get(r.articleId)
    return !!type && (r.status === 'ai_draft' || r.status === 'reviewed')
  })

  const skippedTranslating = rows.filter((r) => r.status === 'translating').length
  const skippedFailed = rows.filter((r) => r.status === 'failed').length

  if (toPublish.length === 0) {
    return { published: 0, skipped: rows.length, skippedTranslating, skippedFailed }
  }

  let published = 0
  for (const r of toPublish) {
    await db.transaction(async (tx) => {
      await tx
        .update(articleTranslations)
        .set({ status: 'published' })
        .where(eq(articleTranslations.id, r.id))

      await tx.insert(activityLogs).values({
        userId: actor.id ?? null,
        action: 'update',
        resource: 'settings',
        resourceId: r.articleId,
        meta: { operation: 'bulk_publish_ai_translation', articleId: r.articleId, langCode: r.langCode, newStatus: 'published' },
      })
    })
    published++
  }

  return {
    published,
    skipped: rows.length - published,
    skippedTranslating,
    skippedFailed,
  }
}

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
