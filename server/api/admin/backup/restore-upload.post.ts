import { requireResourcePermission } from '../../../utils/permissions'
import { restoreUploaded } from '../../../services/backup'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'update')

  const form = await readMultipartFormData(event)
  if (!form || form.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Không tìm thấy file tải lên.' })
  }
  const fileItem = form.find(f => f.name === 'file') || form[0]
  if (!fileItem || !fileItem.data) {
    throw createError({ statusCode: 400, statusMessage: 'File không hợp lệ.' })
  }
  const filename = fileItem.filename || 'restore-backup'
  if (!filename.endsWith('.sql.gz') && !filename.endsWith('.tar.gz')) {
    throw createError({ statusCode: 400, statusMessage: 'Chỉ nhận file .sql.gz hoặc .tar.gz.' })
  }

  try {
    await restoreUploaded(filename, fileItem.data, adminUser.id ?? null)
    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('Một lượt khôi phục khác')) {
      throw createError({ statusCode: 409, statusMessage: msg })
    }
    throw createError({ statusCode: 500, statusMessage: msg })
  }
})
