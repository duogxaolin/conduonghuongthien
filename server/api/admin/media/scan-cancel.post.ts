/**
 * POST /api/admin/media/scan-cancel — yêu cầu hủy job quét đang chạy.
 *
 * Worker kiểm tra cờ `cancelling` giữa các batch → dừng sạch.
 *
 * Quyền `media.create` — hủy quét là thao tác dừng tạo hàng mới.
 */
import { requireResourcePermission } from '../../../utils/permissions'
import { cancelScanJob, getScanJobStatus } from '../../../services/media-scan'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'media', 'create')

  const status = getScanJobStatus()
  if (!status?.running) {
    return { ok: false, message: 'Không có job quét nào đang chạy.' }
  }

  cancelScanJob()
  return { ok: true, message: 'Đã yêu cầu hủy. Worker sẽ dừng ở batch tiếp theo.' }
})
