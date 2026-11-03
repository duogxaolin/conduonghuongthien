import { createError } from 'h3'
import { createSocialLink } from '../../../services/social-links'
import { purgePublicPageCacheAfterWrite } from '../../../utils/public-page-cache'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  const body = await readBody(event).catch(() => ({}))
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Thiếu dữ liệu.' })
  }
  const result = await createSocialLink(adminUser, body as Parameters<typeof createSocialLink>[1])
  // After the service committed: the footer of every cached page and the `swr`-cached
  // `/api/public/social-links` carry these links (server/utils/public-page-cache.ts).
  await purgePublicPageCacheAfterWrite('social_links.create')
  return { ok: true, id: result.id }
})
