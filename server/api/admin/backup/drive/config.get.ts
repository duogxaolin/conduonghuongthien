/**
 * Đọc config OAuth Drive (Client ID + trạng thái secret + redirect URI) cho
 * trang /admin/settings/backup. Quyền `settings.read` — ai được xem cấu hình
 * backup thì được xem config Drive.
 *
 * Redirect URI tính phía server (cùng `resolveDriveRedirectUri` callback dùng)
 * — client không biết PUBLIC_BASE_URL/proxy headers; trình bày ở đây để cán bộ
 * copy sang Google Cloud Console, phải khớp byte-byte.
 */
import { requireResourcePermission } from '../../../../utils/permissions'
import { getDriveOauthConfigRow, serializeDriveOauthConfig } from '../../../../services/backup-drive-oauth-config'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'read')

  const row = await getDriveOauthConfigRow()
  return {
    ok:     true,
    config: serializeDriveOauthConfig(row, event),
  }
})
