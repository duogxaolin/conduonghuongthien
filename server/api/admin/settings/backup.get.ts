import { getDb } from '../../../utils/db'
import { settings } from '../../../db/schema'
import { requireResourcePermission } from '../../../utils/permissions'
import { backupSchedulerEnabledByServer } from '../../../utils/backup-scheduler-switch'

const KEYS = [
  'backup_auto_enabled',
  'backup_auto_hour',
  'backup_auto_days',
  'backup_keep_count',
  'backup_drive_enabled',
  'backup_drive_service_account',
  'backup_drive_folder_id',
] as const

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'read')

  const db = getDb()
  const rows = await db.select().from(settings)
  const map = new Map(rows.map(r => [r.key, r.value]))

  // Service account JSON key — mask nếu đã cấu hình, chỉ superadmin thấy thật.
  const result: Record<string, string | null> = {}
  for (const k of KEYS) {
    if (k === 'backup_drive_service_account' && map.get(k) && !adminUser.isSuperAdmin) {
      result[k] = '********'
    } else {
      result[k] = map.get(k) ?? null
    }
  }
  return {
    ok: true,
    settings: result,
    // Máy chủ không chạy scheduler (BACKUP_SCHEDULER tắt, hoặc ngoài production):
    // công tắc "Backup tự động theo lịch" lưu được nhưng không có lượt nào chạy.
    schedulerDisabledByServer: !backupSchedulerEnabledByServer(process.env.BACKUP_SCHEDULER, process.env.NODE_ENV),
  }
})
