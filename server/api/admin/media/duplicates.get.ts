/**
 * GET /api/admin/media/duplicates — báo cáo hàng `media` trùng lặp (wave2 D-SCAN).
 *
 * Nhóm hàng cùng tên tệp + kích thước, và hàng cùng chỗ lưu (hai hàng một object),
 * kèm số nơi đang dùng URL của từng hàng trên 27 cột tham chiếu. CHỈ ĐỌC — không
 * xoá gì; cán bộ chọn hàng giữ lại rồi xoá hàng thừa qua thư viện (xoá chặn khi URL
 * còn được dùng).
 *
 * Quyền `media.read`.
 */
import { getDb } from '../../../utils/db'
import { requireResourcePermission } from '../../../utils/permissions'
import { findMediaDuplicates } from '../../../services/media-duplicates'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'media', 'read')

  const report = await findMediaDuplicates(getDb())
  return { ok: true, ...report }
})
