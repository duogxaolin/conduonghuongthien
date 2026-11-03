/**
 * Chính sách trả lời của chatbot — cửa vào công khai duy nhất.
 *
 * Tệp này là barrel: xuất lại ĐÚNG những tên nó luôn xuất (15 giá trị + 5 kiểu, ghim ở
 * `tests/service-split-boundaries.test.ts` luật 5), nên mọi nơi gọi — hai endpoint chat,
 * `chat.ts`, `input-length.ts` — giữ một đường import. Bốn tệp test `mock.module` đúng
 * đường này: nơi gọi import thẳng một tệp con sẽ lọt khỏi mock đó (luật 6 của cùng
 * guard chặn).
 *
 * Mã nằm ở các tệp con trong `server/services/` (wave3 D-SPLIT, tách nguyên văn — không
 * đổi hành vi). Chúng KHÔNG nằm cạnh barrel: Nitro tự import mọi export của
 * `server/utils/**`, nên một tệp con ở đây sẽ xuất mỗi tên của API lần thứ hai
 * (`tests/server-utils-unique-exports.test.ts`) và biến helper nội bộ thành tên toàn cục.
 *
 *   - chat-policy-contract.ts   `HOTLINE`, `CHAT_LIMITS` và các kiểu vào/ra
 *   - chat-policy-rate-limit.ts rate limit theo địa chỉ + hạn mức AI (phiên + trần địa chỉ)
 *   - chat-policy-request.ts    kiểm thân request và danh sách lượt
 *   - chat-policy-prompt.ts     lời nhắc hệ thống có căn cứ + lịch sử gửi model
 *   - chat-policy-fallbacks.ts  câu của kho, câu kể hoàn cảnh, small-talk, ngoài phạm vi
 *   - chat-policy-provider.ts   gọi AI qua cổng (năm công cụ) / đường gọi cũ (KHÔNG xuất lại)
 *   - chat-policy-answer.ts     `answerGroundedChat` — định tuyến một lượt
 *
 * Tệp con import lẫn nhau, không bao giờ import barrel này.
 */

export { HOTLINE, CHAT_LIMITS } from '../../services/chat-policy-contract'
export type { ChatMessage, ChatToolCall, ChatResult, ChatEvent, ChatDependencies } from '../../services/chat-policy-contract'

export {
  AI_QUOTA_RULE,
  AI_IP_CEILING_RULE,
  enforceChatRateLimit,
  CHAT_RATE_LIMITED_MESSAGE,
  chargeChatRateLimit,
  enforceAiQuota,
} from '../../services/chat-policy-rate-limit'

export { validateChatRequestBody, validateChatMessages } from '../../services/chat-policy-request'

export { buildGroundedSystemPrompt, buildChatHistory, buildChatMessages } from '../../services/chat-policy-prompt'

export { approvedFallback } from '../../services/chat-policy-fallbacks'

export { answerGroundedChat } from '../../services/chat-policy-answer'
