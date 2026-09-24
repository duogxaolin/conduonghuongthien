import { createError } from 'h3'
import { requireResourcePermission } from '../../../utils/permissions'
import { deleteLanguage } from '../../../services/languages'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'delete')

  const code = getRouterParam(event, 'code')
  if (!code) throw createError({ statusCode: 400, statusMessage: 'Mã ngôn ngữ bắt buộc.' })

  await deleteLanguage(adminUser, code)
  return { ok: true }
})
