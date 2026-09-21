import { requireResourcePermission } from '../../../utils/permissions'
import { getBackupStatus, getRestoreStatus } from '../../../services/backup'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'read')

  return {
    ok: true,
    backup: getBackupStatus(),
    restore: getRestoreStatus(),
  }
})
