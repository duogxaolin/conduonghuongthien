import { requireResourcePermission } from '../../../utils/permissions'
import { listAllSocialLinks } from '../../../services/social-links'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'read')
  const items = await listAllSocialLinks()
  return { ok: true, items }
})
