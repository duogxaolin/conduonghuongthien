import { requireResourcePermission } from '../../../utils/permissions'
import { scanUniversalCoverage } from '../../../services/universal-translation'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'read')

  const stats = await scanUniversalCoverage()
  return {
    ok: true,
    stats,
  }
})
