import { createKnowledge, adminKnowledge, ChatbotKnowledgeValidationError } from '../../../../services/chatbot-knowledge'
import { requireChatbotKnowledgePermission } from '../../../../utils/permissions'

export default defineEventHandler(async (event) => {
  const actor = requireChatbotKnowledgePermission(event, 'create')
  try { const entry = await createKnowledge(actor.id, await readBody(event).catch(() => ({}))); return { ok: true, item: adminKnowledge(entry) } }
  catch (error) { if (error instanceof ChatbotKnowledgeValidationError) throw createError({ statusCode: 400, statusMessage: error.message }); throw error }
})
