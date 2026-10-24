import { requireResourcePermission } from '../../../utils/permissions'
import { BackupLockBusyError, BackupNameCollisionError, runBackup, type BackupType, type BackupTrigger } from '../../../services/backup'

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
    // "Chưa được, thử lại sau" — phân biệt bằng KIỂU lỗi, không so chuỗi: một lượt
    // khác đang giữ khoá, hoặc tên tệp của lượt này đã có (cùng trigger trong cùng giây).
    if (err instanceof BackupLockBusyError || err instanceof BackupNameCollisionError) {
      throw createError({ statusCode: 409, statusMessage: msg })
    }
    throw createError({ statusCode: 500, statusMessage: msg })
  }
})
