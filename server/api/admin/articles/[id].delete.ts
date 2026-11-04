import { deleteArticleById } from '../../../services/articles'
import { purgePublicPageCacheAfterWrite } from '../../../utils/public-page-cache'
import { bumpAnswerCacheVersion } from '../../../services/chatbot-answer-cache'

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid article ID' })

  // The permission check lives inside the service because it depends on the
  // article's type, which is only known after the row is read.
  await deleteArticleById(event.context.adminUser, id)
  // After the delete, never before it: the deleted page now renders 404, and Nitro
  // never overwrites a cached 200 with a 404 — without this the article stayed public
  // until someone pressed "Xoá cache" (server/utils/public-page-cache.ts).
  await bumpAnswerCacheVersion().catch(() => undefined)
  await purgePublicPageCacheAfterWrite('articles.delete')
  return { ok: true }
})
