/**
 * Lưu cấu hình layout chung (settings.layout_config) + audit transaction.
 * Quyền: settings.update.
 */
import { requireResourcePermission } from '../../../utils/permissions'
import { validateLayoutConfig, saveLayoutConfig } from '../../../services/layout-settings'
import { purgePublicPageCacheAfterWrite } from '../../../utils/public-page-cache'

export default defineEventHandler(async (event) => {
  const admin = event.context.adminUser
  if (!admin) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  requireResourcePermission(admin, 'settings', 'update')

  const body = await readBody(event).catch(() => null)
  const config = validateLayoutConfig(body)

  await saveLayoutConfig(admin, config)
  // Sau commit (saveLayoutConfig ghi + audit trong một transaction): bề rộng khung và cấu
  // hình layout nằm trong HTML đã đệm `swr` của mọi trang công khai.
  await purgePublicPageCacheAfterWrite('settings.layout_config')
  return { ok: true, config }
})
