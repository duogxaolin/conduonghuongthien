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
  return { ok: true, source: { id: result.id, question: result.question, topic: result.topic, source: result.source } }
})
