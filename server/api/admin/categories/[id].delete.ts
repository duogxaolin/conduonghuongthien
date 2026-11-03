import { deleteCategoryById } from '../../../services/categories'
import { purgePublicPageCacheAfterWrite } from '../../../utils/public-page-cache'

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid category ID' })

  // Permission and the child/article guards live in the service, so this route
  // and the bulk one cannot drift apart.
  await deleteCategoryById(event.context.adminUser, id)
  // After the service committed: `/news/<category>` now renders 404 (server/utils/public-page-cache.ts).
  await purgePublicPageCacheAfterWrite('categories.delete')

  return { ok: true }
})
