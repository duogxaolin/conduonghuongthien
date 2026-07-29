import { updateSmallTalk, adminSmallTalk, ChatbotSmallTalkValidationError } from '../../../../services/chatbot-small-talk'
import { requireChatbotSmallTalkPermission } from '../../../../utils/permissions'

export default defineEventHandler(async (event) => {
  const actor = requireChatbotSmallTalkPermission(event, 'update')
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isSafeInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: 'Invalid small-talk ID' })
  try {
    const item = await updateSmallTalk(actor.id, id, await readBody(event).catch(() => ({})))
    if (!item) throw createError({ statusCode: 404, statusMessage: 'Small-talk entry not found' })
    return { ok: true, item: adminSmallTalk(item) }
  } catch (error) {
    if (error instanceof ChatbotSmallTalkValidationError) throw createError({ statusCode: 400, statusMessage: error.message })
    throw error
  }
})
