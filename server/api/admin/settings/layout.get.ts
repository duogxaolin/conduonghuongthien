/**
 * Đọc cấu hình layout chung của site (settings.layout_config).
 * Quyền: settings.read — cùng boundary các trang settings khác.
 *
 * Đọc CSDL hỏng (`getLayoutConfig` ném, R8-4) → 500 với câu tiếng Việt đã phân loại, không phải
 * "Server Error" mặc định của Nitro: hai trang quản trị in nguyên câu này trong `role="alert"`.
 * Log chỉ có thông điệp của driver (`driverMessage`) — không bao giờ "Failed query: … params: …".
 */
import { requireResourcePermission } from '../../../utils/permissions'
import { getLayoutConfig } from '../../../services/layout-settings'
import { logError } from '../../../utils/logger'
import { driverMessage } from '../../../utils/mysql-errors'

export const LAYOUT_READ_FAILED_MESSAGE = 'Không đọc được cấu hình bố cục. Vui lòng thử lại.'

export default defineEventHandler(async (event) => {
  const admin = event.context.adminUser
  if (!admin) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  requireResourcePermission(admin, 'settings', 'read')

  const config = await getLayoutConfig().catch((error: unknown) => {
    logError({ event: 'admin_settings.layout_read_failed', error: driverMessage(error) })
    throw createError({ statusCode: 500, statusMessage: LAYOUT_READ_FAILED_MESSAGE })
  })
  return { ok: true, config }
})
