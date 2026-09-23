/**
 * GET /api/admin/media/sync-status — trạng thái job sync đang chạy (hoặc gần xong).
 *
 * UI poll mỗi 3 giây khi `running: true`. Trả `null` nếu chưa có job nào.
 *
 * Quyền `media.read` — đọc status không phải update.
 */
import { requireResourcePermission } from '../../../utils/permissions'
import { getSyncJobStatus } from '../../../services/media-sync'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'media', 'read')

  const status = getSyncJobStatus()
  return { ok: true, status }
})
