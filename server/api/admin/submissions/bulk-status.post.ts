import { createError } from 'h3'
import { changeSubmissionStatus } from '../../../services/submission-workflow'
import { isSubmissionStatus } from '../../../../app/utils/submission-status'
import { parseBulkIds, runBulk } from '../../../utils/bulk'

/**
 * Đổi trạng thái xử lý cho nhiều đơn một lượt.
 *
 * Tồn tại vì lý do đã ghi ở `articles/bulk-comments.post.ts`: không có nó thì
 * "đóng ba mươi đơn đã xử lý xong của tháng trước" là ba mươi lần mở hồ sơ, và
 * đúng loại ma sát vĩnh viễn đó dẫn tới việc trạng thái không bao giờ được cập
 * nhật — rồi bộ lọc trở thành thứ không ai tin.
 *
 * Kiểm quyền nằm **trong service theo từng hàng**, không kiểm một lần ở đây: quy
 * tắc chuyển tiếp phụ thuộc trạng thái **hiện tại của chính hàng đó**, nên một lô
 * ba mươi đơn có thể có hàng hợp lệ lẫn hàng không. `runBulk` trả về phần thành
 * công kèm lý do cho từng hàng bị từ chối, thay vì một lượt thất bại toàn bộ.
 */
export default defineEventHandler(async (event) => {
  const actor = event.context.adminUser
  const body = await readBody(event).catch(() => ({}))

  const status = (body as { status?: unknown } | null)?.status
  if (!isSubmissionStatus(status)) {
    throw createError({ statusCode: 400, statusMessage: 'Trạng thái xử lý không hợp lệ.' })
  }

  const ids = parseBulkIds(body)
  return runBulk(
    ids,
    id => changeSubmissionStatus(actor, id, { status }).then(() => undefined),
    'Không thể đổi trạng thái đơn đăng ký này.',
  )
})
