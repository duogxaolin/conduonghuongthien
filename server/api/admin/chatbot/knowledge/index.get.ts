import { listKnowledge, adminKnowledge, ChatbotKnowledgeValidationError } from '../../../../services/chatbot-knowledge'
import { requireChatbotKnowledgePermission } from '../../../../utils/permissions'

export default defineEventHandler(async (event) => {
  requireChatbotKnowledgePermission(event, 'read')
  const query = getQuery(event)
  try {
    const result = await listKnowledge({ page: Number(query.page || 1), perPage: Number(query.perPage || 20), search: String(query.search || ''), topic: String(query.topic || ''), status: String(query.status || '') })
    return { ok: true, items: result.items.map(item => adminKnowledge(item)), pagination: result.pagination }
  } catch (error) { if (error instanceof ChatbotKnowledgeValidationError) throw createError({ statusCode: 400, statusMessage: error.message }); throw error }
})
