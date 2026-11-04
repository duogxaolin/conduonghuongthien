import { createSmallTalk, adminSmallTalk, ChatbotSmallTalkValidationError } from '../../../../services/chatbot-small-talk'
import { requireChatbotSmallTalkPermission } from '../../../../utils/permissions'
import { bumpAnswerCacheVersion } from '../../../../services/chatbot-answer-cache'

export default defineEventHandler(async (event) => {
  const actor = requireChatbotSmallTalkPermission(event, 'create')
  try {
    const entry = await createSmallTalk(actor.id, await readBody(event).catch(() => ({})))
    await bumpAnswerCacheVersion().catch(() => undefined)
    return { ok: true, item: adminSmallTalk(entry) }
  } catch (error) {
    if (error instanceof ChatbotSmallTalkValidationError) throw createError({ statusCode: 400, statusMessage: error.message })
    throw error
  }
})
