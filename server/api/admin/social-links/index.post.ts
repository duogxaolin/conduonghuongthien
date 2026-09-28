import { createError } from 'h3'
import { createSocialLink } from '../../../services/social-links'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  const body = await readBody(event).catch(() => ({}))
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Thiếu dữ liệu.' })
  }
  const result = await createSocialLink(adminUser, body as Parameters<typeof createSocialLink>[1])
  return { ok: true, id: result.id }
})
