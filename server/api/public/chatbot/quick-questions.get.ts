import { eq, and, desc, asc } from 'drizzle-orm'
import { chatbotKnowledge } from '../../../db/schema'
import { getDb } from '../../../utils/db'

export default defineEventHandler(async () => {
  try {
    const items = await getDb().select({ id: chatbotKnowledge.id, question: chatbotKnowledge.canonicalQuestion, topic: chatbotKnowledge.topic }).from(chatbotKnowledge).where(and(eq(chatbotKnowledge.status, 'published'), eq(chatbotKnowledge.isQuickQuestion, true))).orderBy(desc(chatbotKnowledge.priority), asc(chatbotKnowledge.id)).limit(8)
    return { ok: true, available: items.length > 0, items }
  } catch { return { ok: false, available: false, items: [] } }
})
