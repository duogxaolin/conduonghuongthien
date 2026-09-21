/**
 * Gỡ client secret Drive + ép công tắc tắt, giữ client id để cán bộ không phải
 * tra lại. POST (không DELETE) vì hàng sống sót — DELETE trên path settings đọc
 * là "xoá cấu hình", không phải việc này làm. Quyền `settings.update`.
 */
import { requireResourcePermission } from '../../../../utils/permissions'
import { clearDriveOauthSecret, getDriveOauthConfigRow, serializeDriveOauthConfig } from '../../../../services/backup-drive-oauth-config'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'update')
  await clearDriveOauthSecret(adminUser.id, event.context.requestId)
  const row = await getDriveOauthConfigRow()
  return { ok: true, config: serializeDriveOauthConfig(row, event) }
})
