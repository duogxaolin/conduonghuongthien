/**
 * Chữ giao diện của chatbot (widget + /assistant) là KHOÁ DỊCH, dịch ở component bằng `t()`.
 *
 * Trạng thái chat sống ở cấp module (`composables/chatbot/state.ts`, chung cho hai bề mặt),
 * nơi không gọi được `useI18n()` — và trên máy chủ, giữ một hàm dịch ở cấp module là đem
 * ngôn ngữ của request này sang request khác. Nên module chỉ nói "đang ở trạng thái nào"
 * (`quickQuestionState`, `msg.kind`, tiêu đề mặc định), còn chữ được chọn ở đây và dịch ở
 * template. Bản tiếng Anh từng hiện nguyên các câu tiếng Việt viết cứng trong module.
 * tests/public-ui-english.test.ts.
 */
import { CHATBOT_UNTITLED, type StoredConversation } from './chatbot-storage'
import { countKey, fillPlaceholders } from './i18n-placeholders'

type Translate = (key: string) => string

/** Dòng trạng thái của dải câu hỏi gợi ý, theo `quickQuestionState`: mỗi trạng thái một câu. */
export const QUICK_QUESTION_STATUS_KEYS = {
  loading: 'cw_qq_loading',
  error: 'cw_qq_error',
  empty: 'cw_qq_empty',
  success: 'cw_qq_ready',
} as const

const MESSAGE_KIND_KEYS: Record<string, string> = {
  curated: 'cw_kind_curated',
  provider: 'cw_kind_provider',
  small_talk: 'cw_kind_small_talk',
  not_found: 'cw_kind_not_found',
  unavailable: 'cw_kind_unavailable',
  rate_limited: 'cw_kind_rate_limited',
}

/** Khoá của nhãn dưới một câu trả lời ("Trả lời từ nội dung đã phê duyệt"…); `''` nếu không có. */
export function messageKindKey(kind: string | undefined): string {
  return MESSAGE_KIND_KEYS[kind ?? ''] ?? ''
}

/** Lời mời xoay vòng cạnh nút mở chat (`useChatWidgetTeaser`). */
export const CHAT_TEASER_KEYS = [
  'cw_teaser_1', 'cw_teaser_2', 'cw_teaser_3', 'cw_teaser_4', 'cw_teaser_5', 'cw_teaser_6', 'cw_teaser_7',
] as const

/**
 * Tiêu đề hiển thị của một cuộc trò chuyện. `CHATBOT_UNTITLED` là dấu hiệu lưu trong
 * localStorage và được so bằng `===` (send.ts chỉ đặt tiêu đề khi còn mặc định), nên nó không
 * bao giờ được dịch lúc lưu — chỉ lúc hiện.
 */
export function conversationTitleText(title: string, t: Translate): string {
  return title === CHATBOT_UNTITLED ? t('asst_new_conv') : title
}

/** "3 tin nhắn · 29/10/2026" / "Chưa có tin nhắn · …" (ngày theo dd/mm/yyyy như cả cổng). */
export function conversationMetaText(conversation: StoredConversation, t: Translate): string {
  const count = conversation.messages.filter(item => item.id !== 'welcome').length
  const when = new Date(conversation.createdAt)
  const date = Number.isNaN(when.getTime()) ? '' : when.toLocaleDateString('vi-VN')
  return fillPlaceholders(t(count ? countKey('cw_meta_count', count) : 'cw_meta_empty'), { n: count, date })
}
