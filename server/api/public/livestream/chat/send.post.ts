/**
 * Gửi một tin nhắn vào phòng chat của buổi phát đang chạy.
 *
 * ## Danh tính lấy từ VÉ, không bao giờ từ thân request
 *
 * `requireReader` trả về danh tính đã giải từ cookie phiên (401 khi chưa đăng nhập,
 * 403 khi bị chặn), và ba trường gửi xuống service đều lấy từ **đó**. Không có
 * `displayName`, `readerId` hay bất cứ trường nào của thân request đi vào
 * `ChatSender` — nên không có ô nào để một script tự nhận là người khác. Đó cũng là
 * lý do `ChatSender` chỉ có ba trường và **không** có tên hiển thị đã giải sẵn: tên
 * được suy ra bên trong service bằng `effectiveDisplayName`, nên nơi gọi thứ hai
 * cũng không truyền được một cái tên vào.
 *
 * ## Mọi lý do từ chối nằm trong `sendChatMessage`, không ở đây
 *
 * Bốn lý do (nội dung, không có buổi phát nào đang chạy, hai hạn mức) và **thứ tự**
 * của chúng sống trong service — nơi `tests/livestream-chat.test.ts` kiểm được
 * chúng mà không cần dựng một máy chủ HTTP. Chép một phần của chuỗi đó lên đây là
 * tạo ra một đường ghi thứ hai thiếu ba trong bốn lượt kiểm.
 *
 * Hệ quả trực tiếp: endpoint này **không** tự kiểm tra có buổi phát nào đang chạy
 * hay không. Lượt kiểm đó là lý do từ chối #2 của service, và nó trả 409 — không
 * phải 404, vì buổi phát không "không tồn tại", nó chỉ chưa bắt đầu.
 *
 * ## `getClientIp(event)`, không bao giờ `getRequestIP`
 *
 * Hạn mức theo địa chỉ (50 tin / 5 phút) băm giá trị này. Sau nginx, `getRequestIP`
 * trả gateway của docker bridge cho **mọi** khách, nên hạn mức toàn cục biến thành
 * "50 tin rồi cả internet bị chặn" — và nó trông y hệt một hạn mức đang chạy đúng.
 *
 * ## Phản hồi chỉ mang `id`, và đó là chủ đích
 *
 * Người gửi nhận tin của chính mình qua **đường phát SSE**, không qua phản hồi này.
 * Nhờ vậy tin của họ nằm đúng thứ tự với mọi tin khác thay vì được chèn lạc vào chỗ
 * mà trình duyệt đoán. Số người đang xem (`delivered`) cũng **không** đi ra: đó là
 * một con số về người khác, không phải về người đang hỏi.
 */
import { defineEventHandler, readBody, setResponseHeader, setResponseStatus } from 'h3'

import { requireReader } from '../../../../utils/reader-auth'
import { getClientIp } from '../../../../utils/client-ip'
import { sendChatMessage } from '../../../../services/livestream-chat'

export default defineEventHandler(async (event) => {
  const reader = await requireReader(event)

  const body = await readBody(event).catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Dữ liệu không hợp lệ.' })
  }

  const { content, sessionId } = body as Record<string, unknown>

  const result = await sendChatMessage({
    sender: {
      id:                reader.id,
      displayName:       reader.displayName,
      customDisplayName: reader.customDisplayName,
    },
    ip:      getClientIp(event),
    content,
    sessionId,
  })

  if (!result.ok) {
    // `retry-after` là thứ trình duyệt và mọi trung gian đọc được, nên nó đi cùng
    // 429 chứ không nằm trong lời văn. Cùng khuôn với đường ghi bình luận.
    if (result.retryAfterSeconds) setResponseHeader(event, 'retry-after', result.retryAfterSeconds)
    throw createError({ statusCode: result.statusCode, statusMessage: result.message })
  }

  setResponseStatus(event, 201)
  return { ok: true, id: result.id }
})
