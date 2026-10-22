import { and, count, eq } from 'drizzle-orm'
import { getDb } from '../../../utils/db'
import { articles, articleTranslations } from '../../../db/schema'
import { requireResourcePermission } from '../../../utils/permissions'
import { getBulkTranslationTaskState } from '../../../services/article-translations'
import { articleActionScope } from '../../../services/articles'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'news', 'read')

  const state = getBulkTranslationTaskState()
  const db = getDb()

  // The job walks articles of every type; `news:read` opens this route but not the
  // title of a document or role-model article the reader cannot open themselves.
  let task = state
  if (state.currentArticleId && adminUser?.isSuperAdmin !== true) {
    const [visible] = await db
      .select({ id: articles.id })
      .from(articles)
      .where(and(eq(articles.id, state.currentArticleId), articleActionScope(adminUser, 'read')))
      .limit(1)
    if (!visible) task = { ...state, currentArticleId: null, currentArticleTitle: null }
  }

  const [translatingRow] = await db
    .select({ count: count() })
    .from(articleTranslations)
    .where(eq(articleTranslations.status, 'translating'))

  const dbTranslatingCount = Number(translatingRow?.count || 0)

  return {
    ok: true,
    active: state.active || dbTranslatingCount > 0,
    task,
    dbTranslatingCount,
  }
})
