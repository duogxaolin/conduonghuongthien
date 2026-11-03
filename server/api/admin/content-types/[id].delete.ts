import { deleteContentTypeById } from '../../../services/content-types'
import { purgePublicPageCacheAfterWrite } from '../../../utils/public-page-cache'

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid content type ID' })

  await deleteContentTypeById(event.context.adminUser, id)
  // After the service committed (server/utils/public-page-cache.ts).
  await purgePublicPageCacheAfterWrite('content_types.delete')

  return { ok: true }
})
