import { createError } from 'h3'
import { updateSocialLink } from '../../../services/social-links'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'ID không hợp lệ.' })
  }
  const body = await readBody(event).catch(() => ({}))
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Thiếu dữ liệu.' })
  }
  await updateSocialLink(adminUser, id, body as Parameters<typeof updateSocialLink>[2])
  return { ok: true }
})
