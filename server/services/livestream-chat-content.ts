/**
 * Nội dung và tên của một tin chat trực tiếp lúc GỬI — các hàm thuần (chuẩn hoá, chặn, chụp tên)
 * tách nguyên văn khỏi `livestream-chat.ts` (wave3 D-SPLIT, kiểm chứng 4.3c tiếp W7: tệp đó ở
 * trần 546 dòng của `tests/ratchets/file-length.baseline.json`, và nối hạn mức regex của một tin
 * làm nó dài thêm). `livestream-chat.ts` xuất lại các tên công khai, nên nơi gọi và test giữ một
 * đường import. Dạng ra của hàng đã lưu (`serializeChatMessage`) ở lại cạnh câu đọc cột tên —
 * guard S5 của `tests/reader-name-resolver-guard.test.ts` đòi hai thứ cùng tệp. Không đọc CSDL,
 * không có trạng thái.
 */
import { effectiveDisplayName } from '../utils/display-name'
import { hasForbiddenControlChars } from '../utils/plain-text'

/**
 * Độ dài tối đa của một tin nhắn — và nó **phải** khớp `varchar(200)` của cột
 * `livestream_messages.content`.
 *
 * Hai con số này sống ở hai tệp khác nhau và không có gì buộc chúng khớp: MySQL ở
 * chế độ mặc định (`STRICT_TRANS_TABLES`) **từ chối** câu INSERT dài hơn cột chứ
 * không cắt, nên một hằng số lớn hơn cột biến mọi tin nhắn dài thành lỗi 500 —
 * người gửi thấy ô chat của mình hỏng và không có gì chỉ vào nguyên nhân. Nhỏ hơn
 * thì chỉ là một giới hạn chặt hơn cần thiết. `tests/livestream-chat.test.ts` đối
 * chiếu hằng số này với độ dài cột khai trong `schema.ts`.
 */
export const LIVESTREAM_CHAT_MAX_LENGTH = 200

/**
 * Độ dài tối đa của tên hiển thị chụp lại — khớp `varchar(100)`.
 *
 * Khác với nội dung, tên bị **cắt** chứ không bị từ chối. `reader_accounts.display_name`
 * rộng 255 ký tự vì nó là tên Google, nên một cái tên dài hơn 100 là chuyện có
 * thật; từ chối gửi tin vì tên Google của ai đó dài quá là biến một chuyện không
 * liên quan thành một ô chat hỏng. Một cái tên cắt ở 100 ký tự vẫn chỉ ra được
 * người nói, còn một tin nhắn bị từ chối thì mất đúng thứ người ta muốn nói.
 */
export const LIVESTREAM_CHAT_NAME_MAX_LENGTH = 100

/**
 * Danh tính người gửi, **hẹp có chủ đích**.
 *
 * Chỉ ba trường, và không trường nào là tên hiển thị đã giải sẵn: tên được suy ra
 * *bên trong* service bằng `effectiveDisplayName`, nên không nơi gọi nào truyền
 * được một cái tên vào. Một hàm nhận `displayName: string` là một hàm mà nơi gọi
 * thứ hai sẽ truyền `body.name`.
 */
export type ChatSender = {
  id: number
  displayName: string | null
  customDisplayName: string | null
  /** Tên Google là từ dành riêng → hiện "Bạn đọc" (spec reader-display-names-google). */
  displayNameReserved: boolean
}

/** Tin nhắn ở dạng trang công khai được thấy. Không `readerId`, không `isDeleted`. */
export type ChatMessage = {
  id: number
  displayName: string
  content: string
  createdAt: string
}

export type ContentValidation =
  | { ok: true, content: string }
  | { ok: false, message: string }

/**
 * Chuẩn hoá và chặn nội dung, cùng khuôn `validateBody` của bình luận.
 *
 * CRLF gom về LF để trình duyệt Windows và điện thoại cho ra cùng một chuỗi byte —
 * không thì cùng một câu đếm ra hai độ dài khác nhau tuỳ người ta gõ bằng gì. Ký
 * tự điều khiển bị **từ chối** chứ không bị lọc bỏ: một nội dung mang chúng hoặc
 * là lỗi dán, hoặc là một lượt dò, và lọc bỏ sẽ cho người gửi thấy một tin nhắn
 * không phải thứ họ gửi.
 *
 * Quá dài thì **từ chối kèm nêu rõ giới hạn**, không bao giờ cắt ngầm — cùng quy
 * tắc nội dung bình luận và ghi chú xử lý đơn.
 */
export function validateChatContent(raw: unknown): ContentValidation {
  if (typeof raw !== 'string') return { ok: false, message: 'Nội dung tin nhắn không hợp lệ.' }

  const normalized = raw.replace(/\r\n?/g, '\n').trim()
  if (!normalized) return { ok: false, message: 'Vui lòng nhập nội dung tin nhắn.' }

  if (hasForbiddenControlChars(normalized)) {
    return { ok: false, message: 'Nội dung tin nhắn chứa ký tự không được phép.' }
  }

  if (normalized.length > LIVESTREAM_CHAT_MAX_LENGTH) {
    return { ok: false, message: `Nội dung tin nhắn quá dài (tối đa ${LIVESTREAM_CHAT_MAX_LENGTH} ký tự).` }
  }

  return { ok: true, content: normalized }
}

/**
 * Tên hiển thị chụp vào hàng tin nhắn, đã cắt theo bề rộng cột.
 *
 * Đây là 12.9: tên được chụp **lúc gửi**, nên một lượt đổi tên sau đó không viết
 * lại được thứ hàng trăm người đã đọc.
 */
export function snapshotDisplayName(sender: ChatSender): string {
  return effectiveDisplayName({
    customDisplayName: sender.customDisplayName,
    displayName:      sender.displayName,
    displayNameReserved: sender.displayNameReserved,
  }).slice(0, LIVESTREAM_CHAT_NAME_MAX_LENGTH)
}
