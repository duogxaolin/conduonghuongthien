import { createError } from 'h3'
import { deleteSocialLink } from '../../../services/social-links'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'ID không hợp lệ.' })
  }
  await deleteSocialLink(adminUser, id)
  return { ok: true }
})
