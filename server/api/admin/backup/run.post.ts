import { requireResourcePermission } from '../../../utils/permissions'
import { runBackup, type BackupType, type BackupTrigger } from '../../../services/backup'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'update')

  const body = await readBody<{ type?: string }>(event)
  const type = body?.type
  if (type !== 'sql' && type !== 'files' && type !== 'all') {
    throw createError({ statusCode: 400, statusMessage: 'Loại backup không hợp lệ (sql | files | all).' })
  }

  try {
    const result = await runBackup(type as BackupType, 'manual' as BackupTrigger, adminUser.id ?? null)
    return { ok: true, ...result }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('Một lượt backup khác')) {
      throw createError({ statusCode: 409, statusMessage: msg })
    }
    throw createError({ statusCode: 500, statusMessage: msg })
  }
})
