import { deleteKnowledge } from '../../../../services/chatbot-knowledge'
import { requireChatbotKnowledgePermission } from '../../../../utils/permissions'

export default defineEventHandler(async (event) => { const actor = requireChatbotKnowledgePermission(event, 'delete'); const id = Number(getRouterParam(event, 'id')); if (!Number.isSafeInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: 'Invalid knowledge ID' }); if (!await deleteKnowledge(actor.id, id)) throw createError({ statusCode: 404, statusMessage: 'Knowledge entry not found' }); return { ok: true } })
