import { createError } from 'h3'
import { requireResourcePermission } from '../../../utils/permissions'
import { deleteLanguage } from '../../../services/languages'
import { purgePublicPageCacheAfterWrite } from '../../../utils/public-page-cache'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'delete')

  const code = getRouterParam(event, 'code')
  if (!code) throw createError({ statusCode: 400, statusMessage: 'Mã ngôn ngữ bắt buộc.' })

  await deleteLanguage(adminUser, code)
  // After the service committed: the language switcher is in every cached page's HTML.
  await purgePublicPageCacheAfterWrite('languages.delete')
  return { ok: true }
})
