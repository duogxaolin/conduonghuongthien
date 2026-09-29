/**
 * Lưu cấu hình layout chung (settings.layout_config) + audit transaction.
 * Quyền: settings.update.
 */
import { requireResourcePermission } from '../../../utils/permissions'
import { validateLayoutConfig, saveLayoutConfig } from '../../../services/layout-settings'

export default defineEventHandler(async (event) => {
  const admin = event.context.adminUser
  if (!admin) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  requireResourcePermission(admin, 'settings', 'update')

  const body = await readBody(event).catch(() => null)
  const config = validateLayoutConfig(body)

  await saveLayoutConfig(admin, config)
  return { ok: true, config }
})
