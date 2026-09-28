import { createError } from 'h3'
import { reorderSocialLinks } from '../../../services/social-links'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  const body = await readBody(event).catch(() => ({}))
  const orderedIds = Array.isArray(body?.orderedIds) ? body.orderedIds : Array.isArray(body?.ids) ? body.ids : []
  if (orderedIds.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Danh sách ID rỗng.' })
  }
  await reorderSocialLinks(adminUser, orderedIds)
  return { ok: true }
})
