import { createError } from 'h3'
import { reorderSocialLinks } from '../../../services/social-links'
import { purgePublicPageCacheAfterWrite } from '../../../utils/public-page-cache'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  const body = await readBody(event).catch(() => ({}))
  const orderedIds = Array.isArray(body?.orderedIds) ? body.orderedIds : Array.isArray(body?.ids) ? body.ids : []
  if (orderedIds.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Danh sách ID rỗng.' })
  }
  await reorderSocialLinks(adminUser, orderedIds)
  // After the service committed (same reason as index.post.ts).
  await purgePublicPageCacheAfterWrite('social_links.reorder')
  return { ok: true }
})
