import { ref, computed } from 'vue'
import {
  CHATBOT_CLIENT_LIMITS,
  CHATBOT_WELCOME_MESSAGE,
  type ChatMessage,
  type StoredConversation,
} from '../../utils/chatbot-storage'

/**
 * All chatbot state, shared by the floating widget and the full-screen /assistant page.
 *
 * Module-level refs, not per-call state: both surfaces must show the same
 * conversations, and a visitor who expands the widget mid-conversation should
 * land on that same conversation rather than a fresh one.
 *
 * One module of `useChatbot` (wave3 split of the 857-line composable): the refs live
 * here and nowhere else, so every part reads and writes the same ones. The parts sit in
 * `composables/chatbot/` without an `index.ts`, so Nuxt does not auto-import their
 * exports — the public surface is still exactly what `useChatbot.ts` exports.
 *
 * Every browser-only API (localStorage, matchMedia) is reached behind an
 * `import.meta.client` guard so importing this file during SSR is inert.
 */

export const conversations = ref<StoredConversation[]>([])
export const activeId = ref<string>('')
export const isSubmitting = ref(false)
/**
 * The reply is in the transcript and being written. `isSubmitting` stays true
 * until the stream closes; the pending indicator must not, or it sits under an
 * answer that is already arriving and then vanishes at the end, jolting the
 * transcript up by its own height.
 */
export const isReplyStreaming = ref(false)
export const isAwaitingFirstWord = computed(() => isSubmitting.value && !isReplyStreaming.value)
export const botInput = ref('')
export const botInputError = ref('')
/**
 * Trần ký tự của ô nhập. Mặc định 2000 (`CHATBOT_CLIENT_LIMITS`); máy chủ áp
 * `min(10000, cài đặt max_input_chars)` nhưng không có endpoint công khai nào cho
 * biết trước con số đó. Khi máy chủ từ chối một câu vì quá dài nó kèm `maxChars` —
 * ô nhập (maxlength + bộ đếm) và phép kiểm trước khi gửi theo con số ấy cho tới khi
 * tải lại trang. Chỉ HẠ, không nâng quá 2000: một trần cao hơn ở máy chủ không bao
 * giờ được báo về (không câu nào ≤ 2000 bị từ chối vì độ dài).
 */
export const inputCharLimit = ref<number>(CHATBOT_CLIENT_LIMITS.maxMessageChars)
export const limits = computed(() => ({ ...CHATBOT_CLIENT_LIMITS, maxMessageChars: inputCharLimit.value }))
export const quickQuestions = ref<{ id: string, question: string }[]>([])
export const quickQuestionState = ref<'loading' | 'success' | 'empty' | 'error'>('loading')
export const hydrated = ref(false)

export function newLocalId(): string {
  if (import.meta.client && typeof crypto?.randomUUID === 'function') return crypto.randomUUID()
  return `c-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function blankConversation(): StoredConversation {
  return {
    id: newLocalId(),
    token: null,
    title: 'Cuộc trò chuyện mới',
    createdAt: Date.now(),
    messages: [{ ...CHATBOT_WELCOME_MESSAGE }],
  }
}

export const activeConversation = computed<StoredConversation>(() => {
  const found = conversations.value.find(item => item.id === activeId.value)
  return found ?? conversations.value[0] ?? blankConversation()
})

/** The active conversation's messages — what both surfaces render. */
export const chatMessages = computed<ChatMessage[]>(() => activeConversation.value.messages)
