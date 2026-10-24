import { z } from 'zod'
import { requireResourcePermission } from '../../../utils/permissions'
import { readValidated } from '../../../utils/request-body'
import { BackupLockBusyError, BackupNameCollisionError, runBackup, type BackupTrigger } from '../../../services/backup'

/**
 * `{ type }`, as `/admin/settings/backup` posts it. Read through the shared reader
 * (wave2 5.2): a body that is not a JSON object — truncated, a form, text — is a
 * 400 `Dữ liệu gửi lên không hợp lệ` before anything runs. The bare `readBody` it
 * replaces answered h3's English "Invalid JSON body", got the truncated TEXT when
 * the client sent `; charset=utf-8`, and took a urlencoded `type=all` (what a plain
 * HTML form posts) as a valid request.
 */
const RunBackupBody = z.object({
  type: z.enum(['sql', 'files', 'all'], { error: 'Loại backup không hợp lệ (sql | files | all).' }),
})

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'update')

  const { type } = await readValidated(event, RunBackupBody)

  try {
    const result = await runBackup(type, 'manual' as BackupTrigger, adminUser.id ?? null)
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
