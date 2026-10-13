/**
 * Dịch hàng loạt bài viết sang một ngôn ngữ (chạy nền, tuần tự).
 * Tách nguyên văn từ article-translations.ts; module cũ re-export để import không đổi.
 */
import { eq, and } from 'drizzle-orm'
import { getDb, type Database } from '../utils/db'
import { articleTranslations, articles, activityLogs } from '../db/schema'
import { type ActorLike } from '../utils/permissions'
import { articleResource } from './articles'
import { logWarn } from '../utils/logger'
import { LANGUAGE_NAMES, runTranslationWorker } from './article-translation-worker'

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
