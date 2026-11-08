import { serializePublicKnowledge } from '../../../utils/chatbot/serializers'
import { findPublishedKnowledgeSource } from '../../../services/public-chatbot-queries'

export default defineEventHandler(async (event) => {
  const id = Number(getQuery(event).id)
  if (!Number.isSafeInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: 'Invalid source ID' })
  // Published only — a draft is a 404 exactly like an id that does not exist.
  const item = await findPublishedKnowledgeSource(id)
  if (!item) throw createError({ statusCode: 404, statusMessage: 'Source not found' })
  const result = serializePublicKnowledge(item)
  // `answer` is the approved public text — the same string the chatbot already
  // quotes in its reply. Withholding it here meant a citation the visitor could
  // see but never read: most imported rows carry a source label and no URL.
  return { ok: true, source: { id: result.id, question: result.question, answer: result.answer, topic: result.topic, source: result.source } }
})
