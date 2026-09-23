/**
 * Lịch sử chat của buổi phát **đang chạy**.
 *
 * ## Không đọc cookie người đọc — và đó là điều kiện để khách vãng lai xem được
 *
 * Cùng lý do đã ghi ở `stream.get.ts`: một tin nhắn công khai trong một buổi phát
 * công khai không có trường nào phụ thuộc vào người đang hỏi (`ChatMessage` chỉ có
 * `id`, `displayName`, `content`, `createdAt` — không `readerId`, không `isDeleted`).
 * Thêm một lượt đọc phiên vào đây là thêm một truy vấn cho mỗi lượt mở phòng chỉ để
 * không dùng tới kết quả, và mở một đường cho việc "cá nhân hoá" khối này về sau.
 *
 * ## Phiên do MÁY CHỦ giải, không nhận từ request
 *
 * Endpoint này không có tham số `sessionId`. Nhận một số nguyên từ request là mở
 * lịch sử của **mọi buổi phát cũ** cho bất kỳ ai đoán được một số — kể cả những
 * buổi đã bị gỡ bằng kiểm duyệt.
 *
 * ## `limit` đi thẳng xuống service, KHÔNG tự kẹp ở đây
 *
 * `listChatHistory` gọi `finitePositive(input.limit, CHAT_HISTORY_DEFAULT,
 * CHAT_HISTORY_MAX)`. Kẹp thêm một lần ở đây là dựng bản sao thứ hai của một phép
 * toán biên, và bản sao chỉ được đối chiếu vào lúc một trong hai đổi. `?limit=abc`
 * và `?limit=1e999` đều đã có test ở tầng service.
 *
 * Vượt trần thì phục vụ **ở mức trần**, không từ chối: một lượt hỏi xin nhiều hơn
 * mức máy chủ cho là chuyện bình thường, và trả 400 cho nó là biến một yêu cầu hợp
 * lệ thành một ô chat trống.
 *
 * ## Không có buổi phát nào thì trả `sessionId: null` — trạng thái hợp lệ, không
 * phải lỗi
 *
 * Cùng hình dạng với `active.get.ts`: giao diện phân biệt được "chưa có buổi phát"
 * với "không hỏi được", và chỉ nhánh sau mới đáng hiện một cảnh báo. Trả 404 ở đây
 * sẽ bắt giao diện coi một trạng thái bình thường như một lượt hỏng.
 */
import { defineEventHandler, getQuery, setHeader } from 'h3'

import { listChatHistory } from '../../../../services/livestream-chat'
import { logWarn } from '../../../../utils/logger'

export default defineEventHandler(async (event) => {
  // Một buổi phát có thể bắt đầu hoặc kết thúc ngay sau lượt hỏi này, nên câu trả
  // lời đúng chỉ có giá trị ở thời điểm nó được hỏi — cùng lý do như `active.get.ts`.
  setHeader(event, 'Cache-Control', 'no-store')

  const query = getQuery(event)
  try {
    const history = await listChatHistory({ limit: query.limit })
    return { ok: true, ...history }
  } catch (err: unknown) {
    // Lịch sử chat là tính năng phụ của trang phát trực tiếp; một lượt CSDL hỏng
    // không được phá khung chat đang chạy. Trả JSON an toàn để giao diện rơi
    // vào nhánh "tải lại" thay vì trang lỗi 500 của Nitro. Comment trong CLAUDE.md
    // (mục "Xử lý lỗi ở tầng giao diện"): server không import được `app/utils`,
    // nên xử lý tại chỗ.
    logWarn({ event: 'public.livestream_history_failed', reason: err instanceof Error ? err.message : String(err) })
    return { ok: false, sessionId: null, messages: [] }
  }
})
