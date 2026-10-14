/**
 * Gỡ client secret Drive + ép công tắc tắt, giữ client id để cán bộ không phải
 * tra lại. POST (không DELETE) vì hàng sống sót — DELETE trên path settings đọc
 * là "xoá cấu hình", không phải việc này làm. Quyền `settings.update`.
 */
import { requireResourcePermission, requireSuperAdmin } from '../../../../utils/permissions'
import { clearDriveOauthSecret, getDriveOauthConfigRow, serializeDriveOauthConfig } from '../../../../services/backup-drive-oauth-config'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'update')
  // Đích backup (tài khoản Drive nhận bản sao CSDL + file) chỉ SuperAdmin đổi được
  // — người có `settings.update` vẫn xem trạng thái và chạy backup.
  requireSuperAdmin(adminUser)
  await clearDriveOauthSecret(adminUser.id, event.context.requestId)
  const row = await getDriveOauthConfigRow()
  return { ok: true, config: serializeDriveOauthConfig(row, event) }
})
