import { eq, and, desc, asc } from 'drizzle-orm'
import { chatbotKnowledge } from '../../../db/schema'
import { getDb } from '../../../utils/db'
import { reportPublicReadFailure } from '../../../utils/public-read-failure'

export default defineEventHandler(async (event) => {
  try {
    const items = await getDb().select({ id: chatbotKnowledge.id, question: chatbotKnowledge.canonicalQuestion, topic: chatbotKnowledge.topic }).from(chatbotKnowledge).where(and(eq(chatbotKnowledge.status, 'published'), eq(chatbotKnowledge.isQuickQuestion, true))).orderBy(desc(chatbotKnowledge.priority), asc(chatbotKnowledge.id)).limit(8)
    return { ok: true, available: items.length > 0, items }
  } catch (error) {
    // 503 + log: `useChatbot` đọc `response.ok` trước, nên lượt hỏng hiện ra
    // nhánh lỗi thay vì "chưa có câu hỏi gợi ý" như một kho rỗng.
    reportPublicReadFailure(event, 'public.chatbot_quick_questions_failed', error)
    return { ok: false, available: false, items: [] }
  }
})
