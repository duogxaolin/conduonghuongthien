/**
 * GET /api/admin/media/duplicates — báo cáo hàng `media` trùng lặp (wave2 D-SCAN).
 *
 * Nhóm hàng cùng tên tệp + kích thước, và hàng cùng chỗ lưu (hai hàng một object),
 * kèm số nơi đang dùng URL của từng hàng trên 27 cột tham chiếu. CHỈ ĐỌC — không
 * xoá gì; cán bộ chọn hàng giữ lại rồi xoá hàng thừa qua thư viện (xoá chặn khi URL
 * còn được dùng).
 *
 * Có trần: `truncated` = còn nhóm ngoài trần; `usageTruncated` = lượt đọc cột tham
 * chiếu dừng vì hết giờ / quá số hàng (số nơi dùng là cận dưới). Một báo cáo một lúc:
 * đang có lượt khác → 409.
 *
 * Quyền `media.read`.
 */
import { getDb, getPool } from '../../../utils/db'
import { requireResourcePermission } from '../../../utils/permissions'
import { DuplicateReportBusyError, runMediaDuplicateReport } from '../../../services/media-duplicates'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'media', 'read')

  const pool = getPool()
  if (!pool) throw createError({ statusCode: 503, statusMessage: 'Cơ sở dữ liệu chưa sẵn sàng.' })
  try {
    const report = await runMediaDuplicateReport(getDb(), pool)
    return { ok: true, ...report }
  } catch (err: unknown) {
    if (err instanceof DuplicateReportBusyError) throw createError({ statusCode: 409, statusMessage: err.message })
    throw err
  }
})
