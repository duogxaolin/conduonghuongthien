/**
 * POST /api/admin/media/sync-cancel — yêu cầu hủy job sync đang chạy.
 *
 * Worker kiểm tra cờ `cancelling` giữa các batch → dừng sạch (xử lý nốt file
 * đang upload để không hỏng hàng CSDL). Trả 200 ngay — UI poll status để xem
 * khi nào thực sự dừng.
 *
 * Quyền `media.update` — hủy sync là thao tác update (dừng thay đổi CSDL).
 */
import { requireResourcePermission } from '../../../utils/permissions'
import { cancelSyncJob, getSyncJobStatus } from '../../../services/media-sync'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'media', 'update')

  const status = getSyncJobStatus()
  if (!status?.running) {
    return { ok: false, message: 'Không có job sync nào đang chạy.' }
  }

  cancelSyncJob()
  return { ok: true, message: 'Đã yêu cầu hủy. Worker sẽ dừng ở batch tiếp theo.' }
})
