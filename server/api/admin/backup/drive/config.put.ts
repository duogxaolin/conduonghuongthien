/**
 * Lưu config OAuth Drive (Client ID / Client Secret / bật-tắt). Quyền
 * `settings.update`. Cùng pattern `settings/google-oauth/index.patch.ts`:
 *
 *   - Closed field list, unknown keys refused (không âm thầm drop).
 *   - `clientSecret` là tuỳ chọn: bỏ trống = giữ secret cũ (không ghi đè).
 *   - Validation trong service, error 400 nếu fail.
 *   - `isEnabled=true` chỉ khi đã có clientId + secret (fail-closed).
 */
import { requireResourcePermission } from '../../../../utils/permissions'
import {
  BackupDriveOauthConfigValidationError,
  getDriveOauthConfigRow,
  serializeDriveOauthConfig,
  updateDriveOauthConfig,
  type DriveOauthConfigUpdate,
} from '../../../../services/backup-drive-oauth-config'

const FIELDS = new Set(['clientId', 'clientSecret', 'isEnabled'])

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Dữ liệu cấu hình không hợp lệ.' })
  }

  const unknown = Object.keys(body).filter(key => !FIELDS.has(key))
  if (unknown.length) {
    throw createError({ statusCode: 400, statusMessage: `Trường không được phép: ${unknown.join(', ')}` })
  }

  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'update')

  try {
    await updateDriveOauthConfig(adminUser.id, body as DriveOauthConfigUpdate, event.context.requestId)
    const row = await getDriveOauthConfigRow()
    return { ok: true, config: serializeDriveOauthConfig(row, event) }
  } catch (error) {
    if (error instanceof BackupDriveOauthConfigValidationError) {
      throw createError({ statusCode: 400, statusMessage: error.message })
    }
    throw error
  }
})
