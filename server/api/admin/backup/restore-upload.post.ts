import { requireResourcePermission } from '../../../utils/permissions'
import { restoreUploaded, setRestoreStatusReceiving, setRestoreStatusFailed } from '../../../services/backup'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'update')

  // Báo running NGAY trước khi đọc multipart — đọc body 69MB mất thời gian,
  // nếu không set thì poll status trong lúc đọc body trả initial state
  // {running: false, phase: ""} → UI nghĩ restore chưa chạy → banner biến mất.
  setRestoreStatusReceiving()

  const form = await readMultipartFormData(event)
  if (!form || form.length === 0) {
    setRestoreStatusFailed('Không tìm thấy file tải lên.')
    throw createError({ statusCode: 400, statusMessage: 'Không tìm thấy file tải lên.' })
  }
  const fileItem = form.find(f => f.name === 'file') || form[0]
  if (!fileItem || !fileItem.data) {
    setRestoreStatusFailed('File không hợp lệ.')
    throw createError({ statusCode: 400, statusMessage: 'File không hợp lệ.' })
  }
  const filename = fileItem.filename || 'restore-backup'
  if (!filename.endsWith('.sql.gz') && !filename.endsWith('.tar.gz')) {
    setRestoreStatusFailed('Định dạng file không hỗ trợ.')
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
