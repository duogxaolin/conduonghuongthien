/**
 * Bắt đầu một buổi phát trực tiếp.
 *
 * ## 409 là phản hồi thật, không phải lỗi chung
 *
 * `startLivestream` trả `statusCode: 409` cho hai trường hợp: một lượt bắt đầu/dừng
 * khác đang giữ khoá (`GET_LOCK('cdkt:livestream:active', 0)`), hoặc đang có một
 * buổi phát đang chạy. Cả hai đều là "thử lại" — bản chất của `409 Conflict` là
 * "yêu cầu này xung đột với trạng thái hiện tại của máy chủ", đúng nội dung của
 * nhánh. Bọc thành `500` chuyển một tin nhắn có ý nghĩa thành "cổng đang hỏng",
 * và cán bộ kết luận hệ thống tê liệt khi thực sự họ chỉ cần dừng buổi phát kia
 * rồi bấm lại.
 *
 * Service cũng trả `400` cho dữ liệu vào không dùng được (tiêu đề rỗng, địa chỉ
 * YouTube không nhận ra) và `503` khi không có pool để lấy khoá. Service **kiểm
 * dữ liệu trước khi lấy khoá** — một tiêu đề rỗng không có lý do chiếm khoá của
 * cả hệ thống dù chỉ vài mili giây, nên `400` từ chối trước khi `GET_LOCK` chạm.
 *
 * ## Audit nằm trong service
 *
 * `startLivestream` đã bọc cặp hàng-phiên-bản + `tx.insert(activityLogs)` trong
 * `db.transaction`, và `withNamedLock` là cơ chế ngăn hai lượt bắt đầu đồng thời
 * — service là đủ, endpoint không có cặp audit để lo.
 */
import { defineEventHandler, readBody, setResponseStatus } from 'h3'

import { requireResourcePermission } from '../../../utils/permissions'
import { startLivestream, type StartLivestreamInput } from '../../../services/livestream'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'livestream', 'create')

  const body = await readBody(event).catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Dữ liệu không hợp lệ.' })
  }

  const fields = body as Record<string, unknown>
  // `StartLivestreamInput` khai `title: unknown` (không optional), nên service có
  // thẩm quyền kiểm. `undefined` xoá thuộc tính khỏi object nếu nó không có trong
  // thân — đúng nội dung "không gửi", và service báo `400` cho tiêu đề rỗng.
  const input: StartLivestreamInput = {
    title:        fields.title,
    description:  fields.description,
    source:       fields.source,
    youtubeVideoId: fields.youtubeVideoId,
    storagePath:  fields.storagePath,
    thumbnailUrl: fields.thumbnailUrl,
    createdBy:    adminUser.id,
  }

  const result = await startLivestream(input)

  if (!result.ok) {
    throw createError({ statusCode: result.statusCode, statusMessage: result.message })
  }

  setResponseStatus(event, 201)
  return { ok: true, sessionId: result.sessionId }
})
