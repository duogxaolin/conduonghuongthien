import { reportPublicReadFailure } from '../../../utils/public-read-failure'
import { listQuickQuestions } from '../../../services/public-chatbot-queries'

export default defineEventHandler(async (event) => {
  try {
    const items = await listQuickQuestions()
    return { ok: true, available: items.length > 0, items }
  } catch (error) {
    // 503 + log: `useChatbot` đọc `response.ok` trước, nên lượt hỏng hiện ra
    // nhánh lỗi thay vì "chưa có câu hỏi gợi ý" như một kho rỗng.
    reportPublicReadFailure(event, 'public.chatbot_quick_questions_failed', error)
    return { ok: false, available: false, items: [] }
  }
})
