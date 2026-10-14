/**
 * Trần độ dài câu hỏi ở CỬA VÀO của hai endpoint chat công khai
 * (`/api/public/chatbot`, `/api/chat`) — đặt SAU honeypot + trừ hạn mức, TRƯỚC kiểm duyệt.
 *
 * Vì sao cần ở cửa vào: trần này đã tồn tại (`validateChatMessages` trong
 * `chat-policy.ts`: `min(CHAT_LIMITS.maxMessageChars, settings.maxInputChars)`), nhưng
 * chỉ chạy bên trong `answerChat` — tức SAU `fastPreModerate`. Kiểm duyệt (gồm luật
 * regex tuỳ biến) vì thế quét nguyên văn mọi câu hỏi tới trần thân request 64 KB: chi
 * phí quét mỗi cửa sổ có chặn, tổng thì không.
 *
 * Vì sao KHÔNG cố định 2000: trần là một cài đặt của quản trị (`max_input_chars`, mặc
 * định 2000, khoảng 1–10 000, `server/utils/chatbot/settings.ts`). Ghim 2000 ở đây sẽ
 * lặng lẽ đè một quản trị đã nâng lên 5000 — câu hỏi hợp lệ theo cài đặt bị từ chối.
 * Dùng LẠI đúng quy tắc mà `answerChat` áp, chỉ là sớm hơn.
 *
 * (Chủ sở hữu tự nhiên của hàm này là `chat-policy.ts`; nó nằm riêng vì lượt sửa này
 * không được chạm tệp đó — xem báo cáo.)
 */
import { createError } from 'h3'
import { CHAT_LIMITS } from './chat-policy'
import { CHATBOT_DEFAULTS } from './settings'

/** Trần ký tự của một câu hỏi theo cài đặt hiện hành (luôn ≤ `CHAT_LIMITS.maxMessageChars`). */
export function chatInputCharLimit(settings: { maxInputChars?: unknown } | null | undefined): number {
  const configured = Number(settings?.maxInputChars)
  // Cài đặt hỏng/thiếu (không xảy ra với `getChatbotSettings` thật, nhưng một giá trị
  // NaN sẽ làm phép so sánh luôn sai = TẮT trần) → lùi về mặc định thiết kế.
  const effective = Number.isFinite(configured) && configured >= 1 ? Math.floor(configured) : CHATBOT_DEFAULTS.maxInputChars
  return Math.min(CHAT_LIMITS.maxMessageChars, effective)
}

export function chatInputTooLongMessage(limit: number): string {
  return `Câu hỏi không được vượt quá ${limit} ký tự. Vui lòng rút gọn rồi gửi lại.`
}

/** Ném 400 (thông điệp tiếng Việt) khi `text` dài hơn trần; không làm gì khi đủ ngắn. */
export function assertChatInputLength(text: string, settings: { maxInputChars?: unknown } | null | undefined): void {
  const limit = chatInputCharLimit(settings)
  if (text.length <= limit) return
  const message = chatInputTooLongMessage(limit)
  throw createError({ statusCode: 400, statusMessage: message, message, data: { reason: 'input_too_long', maxChars: limit } })
}
