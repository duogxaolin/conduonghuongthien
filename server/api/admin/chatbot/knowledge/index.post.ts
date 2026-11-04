import { createKnowledge, adminKnowledge, ChatbotKnowledgeValidationError } from '../../../../services/chatbot-knowledge'
import { requireChatbotKnowledgePermission } from '../../../../utils/permissions'
import { bumpAnswerCacheVersion } from '../../../../services/chatbot-answer-cache'

export default defineEventHandler(async (event) => {
  const actor = requireChatbotKnowledgePermission(event, 'create')
  try { const entry = await createKnowledge(actor.id, await readBody(event).catch(() => ({}))); await bumpAnswerCacheVersion().catch(() => undefined); return { ok: true, item: adminKnowledge(entry) } }
  catch (error) { if (error instanceof ChatbotKnowledgeValidationError) throw createError({ statusCode: 400, statusMessage: error.message }); throw error }
})
