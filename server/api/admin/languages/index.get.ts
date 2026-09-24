import { requireResourcePermission } from '../../../utils/permissions'
import { listLanguages } from '../../../services/languages'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'read')

  const langs = await listLanguages()
  return { ok: true, items: langs }
})
