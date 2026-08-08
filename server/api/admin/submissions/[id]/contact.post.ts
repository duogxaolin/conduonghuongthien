import { createError } from 'h3'
import { logSubmissionContact } from '../../../../services/submission-workflow'

/**
 * Ghi nhận đã liên hệ người dân qua một hình thức cụ thể (điện thoại / email /
 * khác). Không tự đổi trạng thái — xem lý do ở services/submission-workflow.ts.
 */
export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Mã đơn đăng ký không hợp lệ.' })
  }

  const body = await readBody(event).catch(() => ({}))
  const input = body as { channel?: unknown; note?: unknown } | null
  await logSubmissionContact(event.context.adminUser, id, { channel: input?.channel, note: input?.note })
  return { ok: true }
})
