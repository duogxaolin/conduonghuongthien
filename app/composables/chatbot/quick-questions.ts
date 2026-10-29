import { computed } from 'vue'
import { CHATBOT_CLIENT_LIMITS } from '../../utils/chatbot-storage'
import { quickQuestions, quickQuestionState } from './state'

/**
 * The approved quick questions offered above the input: loaded from the server, never
 * hard-coded, with loading / error / empty each saying something different. Part of
 * `useChatbot` (see `./state.ts`).
 */

let quickQuestionsController: AbortController | null = null

function normalizeQuickQuestion(item: unknown): { id: string, question: string } | null {
  if (!item || typeof item !== 'object') return null
  const raw = item as Record<string, unknown>
  const id = typeof raw.id === 'number' || typeof raw.id === 'string' ? String(raw.id) : ''
  const question = typeof raw.question === 'string' ? raw.question.normalize('NFKC').trim() : ''
  if (!id || !question || question.length > CHATBOT_CLIENT_LIMITS.maxMessageChars) return null
  return { id, question }
}

export async function loadQuickQuestions(): Promise<void> {
  if (quickQuestionsController) quickQuestionsController.abort()
  quickQuestionsController = new AbortController()
  quickQuestionState.value = 'loading'
  quickQuestions.value = []
  try {
    const response = await fetch('/api/public/chatbot/quick-questions', {
      headers: { Accept: 'application/json' },
      signal: quickQuestionsController.signal,
    })
    if (!response.ok) throw new Error('QUICK_QUESTIONS_UNAVAILABLE')
    const data = await response.json() as Record<string, unknown>
    const items = Array.isArray(data?.items)
      ? data.items.slice(0, CHATBOT_CLIENT_LIMITS.maxQuickQuestions).map(normalizeQuickQuestion).filter((value): value is { id: string, question: string } => value !== null)
      : []
    quickQuestions.value = items
    quickQuestionState.value = data?.ok === true && data?.available === true && items.length > 0 ? 'success' : 'empty'
  } catch (error) {
    if ((error as Error)?.name !== 'AbortError') quickQuestionState.value = 'error'
  } finally {
    quickQuestionsController = null
  }
}

/**
 * The one line that explains what the quick-question strip is currently doing.
 *
 * Loading, error and empty each get their own sentence because they mean
 * different things to the visitor: "wait", "the suggestions are broken but the
 * box below still works", and "there are no approved suggestions yet, the box
 * below still works". A single generic message would leave someone staring at an
 * empty strip with no idea whether to wait.
 */
export const quickQuestionStatusText = computed(() => {
  if (quickQuestionState.value === 'loading') return 'Đang tải câu hỏi đã được phê duyệt…'
  if (quickQuestionState.value === 'error') return 'Hiện không thể tải câu hỏi gợi ý. Bạn vẫn có thể nhập câu hỏi bên dưới.'
  if (quickQuestionState.value === 'empty') return 'Hiện chưa có câu hỏi gợi ý đã được phê duyệt. Bạn vẫn có thể nhập câu hỏi bên dưới.'
  return 'Câu hỏi gợi ý từ kho dữ liệu đã phê duyệt'
})
