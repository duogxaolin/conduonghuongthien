import { requireResourcePermission } from '../../../utils/permissions'
import { getBackupStatus, getRestoreStatus } from '../../../services/backup'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'read')

  return {
    ok: true,
    pid: process.pid,
    uptime: Math.round(process.uptime()),
    backup: getBackupStatus(),
    restore: getRestoreStatus(),
  }
})
