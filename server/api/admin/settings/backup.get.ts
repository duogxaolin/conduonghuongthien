import { getDb } from '../../../utils/db'
import { settings } from '../../../db/schema'
import { requireResourcePermission } from '../../../utils/permissions'
import { MASKED_SECRET } from '../../../../shared/settings-credential-rules'

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

  // Service account JSON key (có `private_key`) — che bằng `********` cho MỌI vai
  // trò, kể cả SuperAdmin (spec admin-settings-secrets). Không trang nào cần đọc
  // lại khoá đã lưu: `backup.put.ts` coi `********` là "giữ nguyên", nên biểu mẫu
  // lưu lại dấu che không đổi gì; muốn thay thì dán JSON mới. Rỗng vẫn trả rỗng
  // để trang hiện "chưa cấu hình".
  const result: Record<string, string | null> = {}
  for (const k of KEYS) {
    if (k === 'backup_drive_service_account' && map.get(k)) {
      result[k] = MASKED_SECRET
    } else {
      result[k] = map.get(k) ?? null
    }
  }
  return { ok: true, settings: result }
})
