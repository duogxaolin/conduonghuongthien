/**
 * Khử độc dữ liệu đọc lại từ `localStorage` ở `app/utils/chatbot-storage.ts`.
 *
 * Tách ra vì đó là **biên tin cậy**: khách sửa được `localStorage` bằng
 * devtools, và `ChatSource.url` đi thẳng vào `:href` trên trang công khai. Nằm
 * cùng module với state cấp module và các lời gọi `$fetch` thì chỉ kiểm được
 * bằng cách nạp cả composable.
 *
 * Re-export nguyên vẹn để hai bề mặt (widget + `/assistant`) và các test đang
 * import từ đây không phải đổi đường dẫn.
 */
export * from '../utils/chatbot-storage'
import type { ChatMessage } from '../utils/chatbot-storage'
import { stopTypewriter } from './useChatbotTypewriter'
import { clearChatHistory, createConversation, deleteConversation, switchConversation } from './chatbot/conversations'
import { hydrate, persist } from './chatbot/persistence'
import { loadQuickQuestions, quickQuestionStatusText } from './chatbot/quick-questions'
import { submitBotQuestion } from './chatbot/send'
import { expandedSourceIds, isSourceExpanded, retrySourceDetail, sourceDetailOf, sourceDetails, toggleSourceDetail } from './chatbot/sources'
import {
  activeConversation, activeId, botInput, botInputError, chatMessages, conversations, isAwaitingFirstWord, isSubmitting,
  limits, quickQuestions, quickQuestionState,
} from './chatbot/state'

/**
 * All chatbot state and behaviour, shared by the floating widget and the
 * full-screen /assistant page — the ONE public surface (`useChatbot()` and the named
 * exports below), unchanged by the wave3 split of this 857-line file.
 *
 * The code lives in `composables/chatbot/` (no `index.ts`, so Nuxt auto-imports nothing
 * from there), one concern per file, imported in this order with no cycle:
 *   - `state.ts`           — the module-level refs both surfaces share;
 *   - `persistence.ts`     — `localStorage`: `persist()`, `hydrate()`, the v2 migration;
 *   - `sse.ts`             — `parseSseLine`, one SSE line into the reply (pure);
 *   - `send.ts`            — sending + streaming, and the in-flight request counter;
 *   - `conversations.ts`   — create / switch / delete / clear (each cancels in flight);
 *   - `quick-questions.ts` — the approved quick questions and their status line;
 *   - `sources.ts`         — the full approved answer behind a citation.
 * What stays here: the contact form send (`submitLead`) and the reply-kind labels.
 */

export { parseSseLine } from './chatbot/sse'
export { isSourceExpanded, sourceDetailOf } from './chatbot/sources'

// ─── Lead capture ────────────────────────────────────────────────────────────

async function submitLead(msg: ChatMessage): Promise<void> {
  const lead = msg?.lead
  if (!lead || lead.status === 'sending' || lead.status === 'done') return
  if (!lead.phone.trim() && !lead.email.trim()) {
    lead.error = 'Vui lòng nhập số điện thoại hoặc email để cán bộ liên hệ.'
    return
  }
  lead.status = 'sending'
  lead.error = ''
  try {
    await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)('/api/public/chatbot/lead', {
      method: 'POST',
      body: { name: lead.name, phone: lead.phone, email: lead.email, question: lead.question },
    })
    lead.status = 'done'
  } catch (error) {
    lead.status = 'idle'
    lead.error = (error as { data?: { statusMessage?: string } })?.data?.statusMessage || 'Không gửi được thông tin. Vui lòng thử lại.'
  }
}

// ─── Presentation helpers ────────────────────────────────────────────────────

/** One definition of "this reply did not answer the question". */
export function isProblemKind(kind: string | undefined): boolean {
  return kind === 'not_found' || kind === 'unavailable' || kind === 'rate_limited'
}

export function messageKindLabel(kind: string | undefined): string {
  return ({
    curated: 'Trả lời từ nội dung đã phê duyệt',
    provider: 'Giải thích có tham chiếu nội dung đã phê duyệt',
    small_talk: 'Trả lời chào hỏi',
    not_found: 'Chưa tìm thấy thông tin phù hợp',
    unavailable: 'Dịch vụ tạm thời chưa sẵn sàng',
    rate_limited: 'Tạm giới hạn yêu cầu',
  } as Record<string, string>)[kind ?? ''] || ''
}

export function messageKindClass(kind: string | undefined): string {
  return isProblemKind(kind) ? 'text-[#9a3412]' : 'text-[#385130]'
}

// ─── Public surface ──────────────────────────────────────────────────────────

export function useChatbot() {
  return {
    // state
    conversations,
    activeId,
    activeConversation,
    chatMessages,
    isSubmitting,
    isAwaitingFirstWord,
    botInput,
    botInputError,
    quickQuestions,
    quickQuestionState,
    quickQuestionStatusText,

    // lifecycle
    hydrate,
    persist,
    loadQuickQuestions,

    // conversations
    createConversation,
    switchConversation,
    deleteConversation,
    clearChatHistory,

    // sending
    submitBotQuestion,
    submitLead,
    stopTypewriter,

    // reference detail
    sourceDetails,
    expandedSourceIds,
    sourceDetailOf,
    isSourceExpanded,
    toggleSourceDetail,
    retrySourceDetail,

    // helpers
    // Computed: `maxMessageChars` theo trần máy chủ đã báo (xem `inputCharLimit` ở chatbot/state.ts).
    limits,
    isProblemKind,
    messageKindLabel,
    messageKindClass,
  }
}
