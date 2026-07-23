import { transitionKnowledge, adminKnowledge } from '../../../../../services/chatbot-knowledge'
import { requireChatbotKnowledgePermission } from '../../../../../utils/permissions'

export default defineEventHandler(async (event) => { const actor = requireChatbotKnowledgePermission(event, 'archive'); const id = Number(getRouterParam(event, 'id')); if (!Number.isSafeInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: 'Invalid knowledge ID' }); const item = await transitionKnowledge(actor.id, id, 'archived'); if (!item) throw createError({ statusCode: 404, statusMessage: 'Knowledge entry not found' }); return { ok: true, item: adminKnowledge(item) } })
