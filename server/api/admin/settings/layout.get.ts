/**
 * Đọc cấu hình layout chung của site (settings.layout_config).
 * Quyền: settings.read — cùng boundary các trang settings khác.
 */
import { requireResourcePermission } from '../../../utils/permissions'
import { getLayoutConfig } from '../../../services/layout-settings'

export default defineEventHandler(async (event) => {
  const admin = event.context.adminUser
  if (!admin) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  requireResourcePermission(admin, 'settings', 'read')

  const config = await getLayoutConfig()
  return { ok: true, config }
})
