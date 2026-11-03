/**
 * Kiểm thân request và danh sách lượt chat trước mọi việc khác (trước rate limit,
 * trước truy xuất, trước provider). Tách nguyên văn từ `server/utils/chatbot/chat-policy.ts`
 * (wave3 D-SPLIT).
 */
import type { ChatbotSettings } from '../db/schema'
import { CHAT_MAX_TOTAL_CHARS, CHAT_MAX_TURNS, chatTurnText, isChatTurn, isUserTurn } from '../utils/chatbot/chat-turns'
import { CHAT_LIMITS, type ChatMessage } from './chat-policy-contract'

export function validateChatRequestBody(body: unknown): void {
  if (Buffer.byteLength(JSON.stringify(body ?? null), 'utf8') > CHAT_LIMITS.maxBodyBytes) throw new Error('REQUEST_TOO_LARGE')
}

export function validateChatMessages(messages: unknown, settings: ChatbotSettings): ChatMessage[] {
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > Math.min(CHAT_MAX_TURNS, (settings.maxHistoryMessages + 1) * 2)) throw new Error('INVALID_MESSAGES')
  const accepted = messages.filter(message => {
    if (!message || typeof message !== 'object') return false
    const item = message as ChatMessage
    return isChatTurn(item)
  }).map(message => message as ChatMessage)
  // The last turn is the one answered and stored: it must be the visitor's.
  if (!accepted.length || !isUserTurn(accepted[accepted.length - 1])) throw new Error('INVALID_MESSAGES')
  const total = accepted.reduce((sum, item) => sum + chatTurnText(item).length, 0)
  if (accepted.some(item => !chatTurnText(item) || chatTurnText(item).length > Math.min(CHAT_LIMITS.maxMessageChars, settings.maxInputChars)) || total > CHAT_MAX_TOTAL_CHARS) throw new Error('INVALID_MESSAGES')
  return accepted
}
