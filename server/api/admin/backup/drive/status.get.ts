/**
 * Trạng thái liên kết Google Drive + redirect URI để cán bộ copy vào Google
 * Console. Quyền `settings.read` — ai được xem cấu hình backup thì được xem trạng
 * thái liên kết Drive.
 *
 * Redirect URI được tính phía server (cùng `resolveDriveRedirectUri` mà callback
 * dùng) vì client không biết `PUBLIC_BASE_URL` hay proxy headers; trình bày ở
 * đây để cán bộ copy sang Google Cloud Console — phải khớp byte-byte.
 */
import { requireResourcePermission } from '../../../../utils/permissions'
import { getDriveLinkRow, serializeDriveLink } from '../../../../services/backup-drive-oauth'
import { resolveDriveRedirectUri } from '../../../../utils/google-oauth/config'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'read')

  const row = await getDriveLinkRow()
  return {
    ok:          true,
    link:        serializeDriveLink(row),
    redirectUri: resolveDriveRedirectUri(event),
  }
})
