/**
 * Hợp đồng chung của chính sách chat: hai hằng mọi phần đọc (`HOTLINE`, `CHAT_LIMITS`)
 * và các kiểu vào/ra. Tách nguyên văn từ `server/utils/chatbot/chat-policy.ts` (wave3
 * D-SPLIT).
 *
 * Các phần của chính sách chat nằm ở `server/services/`, không cạnh barrel: Nitro tự
 * import mọi export của `server/utils/**`, nên một phần đặt ở đó sẽ xuất tên của API
 * lần thứ hai (`tests/server-utils-unique-exports.test.ts`).
 *
 * Nơi gọi ngoài nhóm KHÔNG import tệp này: chúng đi qua barrel, đúng đường mà các test
 * `mock.module('…/chat-policy')` thay (vd. `input-length.ts` đọc `CHAT_LIMITS` qua barrel).
 */
import type { H3Event } from 'h3'
import type { ChatbotSettings } from '../db/schema'
import type { SafeProviderRequestOptions, SafeProviderResponse } from '../utils/chatbot/outbound'
import type { retrieveKnowledge, PublicKnowledgeReference, RetrievalEntry } from '../utils/chatbot/retrieval'
import { CHATBOT_HOTLINE } from '../utils/chatbot/prompt-defaults'
import type { SemanticSmallTalkProvider, SmallTalkSemanticConfig } from '../utils/chatbot/small-talk-semantic'
import type { SmallTalkEntry } from '../utils/chatbot/small-talk'
import type { ChatTurn } from '../utils/chatbot/chat-turns'
export const HOTLINE = CHATBOT_HOTLINE
export const CHAT_LIMITS = Object.freeze({ maxBodyBytes: 64_000, maxMessageChars: 10_000, maxOutputChars: 8_000 })

export type ChatMessage = ChatTurn
export type ChatToolCall = { id: string; name: string; arguments?: string; count?: number }

export type ChatResult = {
  answer: string
  sources: PublicKnowledgeReference[]
  kind: 'curated' | 'provider' | 'small_talk' | 'not_found' | 'unavailable' | 'rate_limited'
  retryAfter?: number
  askContact?: boolean
  toolCalls?: ChatToolCall[]
  /** Câu hỏi gợi ý tiếp theo, đã đối chiếu với kho tri thức (`follow-ups.ts`). */
  followUps?: string[]
}
export type ChatEvent = H3Event
export type ChatDependencies = {
  loadPublishedEntries: () => Promise<RetrievalEntry[]>
  loadSmallTalkEntries: () => Promise<SmallTalkEntry[]>
  configuredSecret: (settings: ChatbotSettings) => string | null
  providerRequest: (options: SafeProviderRequestOptions) => Promise<SafeProviderResponse>
  retrieve?: typeof retrieveKnowledge
  semanticSmallTalkProvider?: SemanticSmallTalkProvider | null
  semanticSmallTalkConfig?: Partial<SmallTalkSemanticConfig>
}
