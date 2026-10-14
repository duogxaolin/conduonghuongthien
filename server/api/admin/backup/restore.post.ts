import { requireResourcePermission, requireSuperAdmin } from '../../../utils/permissions'
import { runRestore } from '../../../services/backup-restore'
import { BackupRestoreError } from '../../../services/backup-restore-guards'
import { logWarn, SECURITY_EVENTS } from '../../../utils/logger'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'update')
  // Khôi phục thay toàn bộ CSDL (cả users/roles) — chỉ SuperAdmin, dù có settings.update.
  try {
    requireSuperAdmin(adminUser)
  } catch (err: unknown) {
    logWarn({ event: SECURITY_EVENTS.backupRestoreRefused, userId: adminUser?.id ?? null, username: adminUser?.username, reason: 'not_super_admin', source: 'stored' })
    throw err
  }

  const body = await readBody<{ filename?: string }>(event)
  const filename = body?.filename
  if (!filename || typeof filename !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Thiếu tên file backup.' })
  }

  try {
    const { warning } = await runRestore(filename, { id: adminUser.id ?? null, username: adminUser.username ?? null })
    return { ok: true, warning }
  } catch (err: unknown) {
    if (err instanceof BackupRestoreError) {
      throw createError({ statusCode: err.statusCode, statusMessage: err.message })
    }
    throw createError({ statusCode: 500, statusMessage: err instanceof Error ? err.message : String(err) })
  }
})
