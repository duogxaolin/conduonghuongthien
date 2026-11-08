import { requireResourcePermission } from '../../../utils/permissions'
import { getBulkTranslationTaskState } from '../../../services/article-translations'
import { articleActionScope } from '../../../services/articles'
import { countTranslatingTranslations, findVisibleArticleId } from '../../../services/admin-articles-queries'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'news', 'read')

  const state = getBulkTranslationTaskState()

  // The job walks articles of every type; `news:read` opens this route but not the
  // title of a document or role-model article the reader cannot open themselves.
  let task = state
  if (state.currentArticleId && adminUser?.isSuperAdmin !== true) {
    const visible = await findVisibleArticleId(state.currentArticleId, articleActionScope(adminUser, 'read'))
    if (!visible) task = { ...state, currentArticleId: null, currentArticleTitle: null }
  }

  const translatingRow = await countTranslatingTranslations()

  const dbTranslatingCount = Number(translatingRow?.count || 0)

  return {
    ok: true,
    active: state.active || dbTranslatingCount > 0,
    task,
    dbTranslatingCount,
  }
})
