import { requireResourcePermission, requireSuperAdmin } from '../../../utils/permissions'
import { restoreUploaded, setRestoreStatusReceiving, setRestoreStatusFailed } from '../../../services/backup-restore'
import { BackupRestoreError, DEFAULT_RESTORE_LIMITS } from '../../../services/backup-restore-guards'
import { logWarn, SECURITY_EVENTS } from '../../../utils/logger'

/** Phần đầu multipart (ranh giới, header từng phần) ngoài nội dung file. */
const MULTIPART_OVERHEAD_BYTES = 1024 * 1024

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'update')
  // Từ chối TRƯỚC khi đổi trạng thái khôi phục và trước khi đọc body multipart:
  // người không đủ quyền không được làm gì ngoài nhận 403.
  try {
    requireSuperAdmin(adminUser)
  } catch (err: unknown) {
    logWarn({ event: SECURITY_EVENTS.backupRestoreRefused, userId: adminUser?.id ?? null, username: adminUser?.username, reason: 'not_super_admin', source: 'upload' })
    throw err
  }

  // Body quá lớn bị từ chối theo Content-Length trước khi đọc vào RAM.
  const declaredLength = Number(getRequestHeader(event, 'content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > DEFAULT_RESTORE_LIMITS.maxCompressedBytes + MULTIPART_OVERHEAD_BYTES) {
    const message = `File vượt quá giới hạn ${Math.round(DEFAULT_RESTORE_LIMITS.maxCompressedBytes / 1024 / 1024)} MB.`
    setRestoreStatusFailed(message)
    logWarn({ event: SECURITY_EVENTS.backupRestoreRefused, userId: adminUser.id ?? null, reason: 'too_large', source: 'upload', bytes: declaredLength })
    throw createError({ statusCode: 413, statusMessage: message })
  }

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

  try {
    // Kiểm tên/chữ ký gzip/trần dung lượng nằm trong service — trước khi ghi đĩa.
    const { warning } = await restoreUploaded(filename, fileItem.data, { id: adminUser.id ?? null, username: adminUser.username ?? null })
    return { ok: true, warning }
  } catch (err: unknown) {
    if (err instanceof BackupRestoreError) {
      throw createError({ statusCode: err.statusCode, statusMessage: err.message })
    }
    throw createError({ statusCode: 500, statusMessage: err instanceof Error ? err.message : String(err) })
  }
})
