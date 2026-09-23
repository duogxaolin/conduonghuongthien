/**
 * Gỡ một tin nhắn chat trực tiếp (kiểm duyệt).
 *
 * ## Gỡ KHÔNG phải xoá
 *
 * `removeChatMessage` đánh dấu `is_deleted = 1`, không xoá hàng. Đặc tả nói thẳng,
 * và lý do là chính hành động kiểm duyệt phải kiểm toán được: một hàng biến mất
 * thì dòng audit vừa ghi không còn gì để đối chiếu. Sau khi gỡ, service phát sự
 * kiện `SSE_EVENT_REMOVAL` tới mọi người đang xem buổi đó qua `broadcastToSession`
 * — người đọc thấy tin nhắn biến mất ngay lập tức, không cần tải lại.
 *
 * ## Gỡ hai lần là thành công, và `alreadyRemoved` là trạng thái
 *
 * Lượt gỡ thứ hai trả `ok: true` với `alreadyRemoved: true`: mục tiêu của người bấm
 * đã đạt được, và báo lỗi là mời họ đi tìm một hàng mà họ không cần biết ai đã gỡ.
 * Endpoint không `404` cho tin đã gỡ — `404` có nghĩa là tin nhắn không tồn tại,
 * một câu khác với "đã được gỡ rồi".
 *
 * `404` chỉ cho tin nhắn không tìm thấy (không có hàng với id đó).
 *
 * ## Audit nằm trong service
 *
 * Service đã bọc `tx.insert(activityLogs)` trong `db.transaction` — endpoint không
 * có cặp audit để lo. `actorId` từ phiên quản trị, **không bao giờ** từ thân
 * request — corpo người bấm là thẩm quyền, không phải dữ liệu.
 */
import { defineEventHandler } from 'h3'

import { requireResourcePermission } from '../../../../utils/permissions'
import { removeChatMessage } from '../../../../services/livestream-chat'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'livestream', 'delete')

  const messageId = Number(event.context.params?.id)
  if (!Number.isSafeInteger(messageId) || messageId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Tin nhắn không hợp lệ.' })
  }

  const result = await removeChatMessage({
    messageId,
    actorId: adminUser.id,
  })

  if (!result.ok) {
    throw createError({ statusCode: result.statusCode, statusMessage: result.message })
  }

  return {
    ok:            true,
    alreadyRemoved: result.alreadyRemoved,
    sessionId:     result.sessionId,
    messageId:     result.messageId,
  }
})
