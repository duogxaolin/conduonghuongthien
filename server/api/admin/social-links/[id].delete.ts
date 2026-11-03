import { createError } from 'h3'
import { deleteSocialLink } from '../../../services/social-links'
import { purgePublicPageCacheAfterWrite } from '../../../utils/public-page-cache'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'ID không hợp lệ.' })
  }
  await deleteSocialLink(adminUser, id)
  // After the service committed (same reason as index.post.ts).
  await purgePublicPageCacheAfterWrite('social_links.delete')
  return { ok: true }
})
