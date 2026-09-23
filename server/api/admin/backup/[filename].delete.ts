import { requireResourcePermission } from '../../../utils/permissions'
import { deleteBackup } from '../../../services/backup'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'update')

  const filename = getRouterParam(event, 'filename')
  if (!filename) throw createError({ statusCode: 400, statusMessage: 'Thiếu tên file.' })

  try {
    await deleteBackup(filename, adminUser.id ?? null)
    return { ok: true }
  } catch (err) {
    throw createError({ statusCode: 500, statusMessage: err instanceof Error ? err.message : String(err) })
  }
})
