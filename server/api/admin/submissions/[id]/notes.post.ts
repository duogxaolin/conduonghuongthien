import { createError } from 'h3'
import { addSubmissionNote } from '../../../../services/submission-workflow'

/**
 * Thêm một ghi chú nghiệp vụ, không đổi trạng thái.
 *
 * Tách khỏi `status.put.ts` vì đây là hai câu hỏi khác nhau: một cán bộ có thể
 * muốn ghi lại một chi tiết ("đã gọi, máy bận, gọi lại sau") mà không có ý định
 * đổi trạng thái đơn ngay lúc đó.
 */
export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Mã đơn đăng ký không hợp lệ.' })
  }

  const body = await readBody(event).catch(() => ({}))
  await addSubmissionNote(event.context.adminUser, id, (body as { note?: unknown } | null)?.note)
  return { ok: true }
})
