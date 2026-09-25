/**
 * POST /api/admin/media/sync-force-reset — buộc gỡ kẹt job sync đang treo.
 *
 * `cancel` chỉ đặt cờ `cancelling` — worker treo ở `await runBackup()` không
 * bao giờ tới điểm check nên không hủy được. Endpoint này đặt `running=false`
 * ngay để bấm lại được, không cần SSH restart container.
 *
 * Quyền `media.update` (cùng sync).
 */
import { requireResourcePermission } from '../../../utils/permissions'
import { forceResetSyncJob, getSyncJobStatus } from '../../../services/media-sync'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'media', 'update')

  const status = getSyncJobStatus()
  if (!status?.running) {
    throw createError({ statusCode: 409, statusMessage: 'Không có job sync nào đang chạy để gỡ kẹt.' })
  }

  const res = forceResetSyncJob()
  if (!res.ok) throw createError({ statusCode: 409, statusMessage: res.message })
  return { ok: true, message: res.message }
})
