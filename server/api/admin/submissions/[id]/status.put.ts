import { createError } from 'h3'
import { changeSubmissionStatus } from '../../../../services/submission-workflow'

/**
 * Đổi trạng thái xử lý của một đơn.
 *
 * Mọi phép kiểm (quyền, trạng thái hợp lệ, chuyển tiếp hợp lệ, độ dài ghi chú)
 * nằm trong service, cùng chỗ với transaction ghi cặp hàng + audit. Handler chỉ
 * đọc id và chuyển body xuống — không có quy tắc nào ở đây để một endpoint thứ
 * hai sau này bỏ sót.
 */
export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Mã đơn đăng ký không hợp lệ.' })
  }

  const body = await readBody(event).catch(() => ({}))
  const result = await changeSubmissionStatus(event.context.adminUser, id, {
    status: (body as { status?: unknown } | null)?.status,
    note: (body as { note?: unknown } | null)?.note,
  })
  return { ok: true, status: result.status }
})
