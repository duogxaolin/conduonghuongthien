import { and, eq } from 'drizzle-orm'
import { chatbotKnowledge } from '../../../db/schema'
import { getDb } from '../../../utils/db'
import { serializePublicKnowledge } from '../../../utils/chatbot/serializers'

export default defineEventHandler(async (event) => {
  const id = Number(getQuery(event).id)
  if (!Number.isSafeInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: 'Invalid source ID' })
  const [item] = await getDb().select().from(chatbotKnowledge).where(and(eq(chatbotKnowledge.id, id), eq(chatbotKnowledge.status, 'published'))).limit(1)
  if (!item) throw createError({ statusCode: 404, statusMessage: 'Source not found' })
  const result = serializePublicKnowledge(item)
  // `answer` is the approved public text — the same string the chatbot already
  // quotes in its reply. Withholding it here meant a citation the visitor could
  // see but never read: most imported rows carry a source label and no URL.
  return { ok: true, source: { id: result.id, question: result.question, answer: result.answer, topic: result.topic, source: result.source } }
})
