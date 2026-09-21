/**
 * Hủy liên kết Google Drive — xoá hàng `backup_drive_oauth` (refresh token + metadata)
 * + audit. Không revoke token ở Google (người dùng tự revoke trong Google account
 * nếu muốn; revoking cần access token còn hạn, và cố ý tránh phụ thuộc đó).
 *
 * Sau khi hủy, backup tiếp theo fallback về Service Account (nếu cấu hình) hoặc
 * báo "chưa liên kết Drive". Quyền `settings.update`.
 */
import { requireResourcePermission } from '../../../../utils/permissions'
import { clearDriveLink } from '../../../../services/backup-drive-oauth'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'update')

  await clearDriveLink(adminUser.id)
  return { ok: true }
})
