import { listSmallTalk, ChatbotSmallTalkValidationError } from '../../../../services/chatbot-small-talk'
import { requireChatbotSmallTalkPermission } from '../../../../utils/permissions'

export default defineEventHandler(async (event) => {
  requireChatbotSmallTalkPermission(event, 'read')
  const query = getQuery(event)
  const enabledRaw = query.enabled === undefined ? undefined : String(query.enabled)
  const enabled = enabledRaw === undefined || enabledRaw === '' ? undefined : enabledRaw === 'true' || enabledRaw === '1'
  try {
    const result = await listSmallTalk({
      page: Number(query.page || 1),
      perPage: Number(query.perPage || 20),
      search: String(query.search || ''),
      category: String(query.category || ''),
      enabled,
    })
    return { ok: true, items: result.items, pagination: result.pagination }
  } catch (error) {
    if (error instanceof ChatbotSmallTalkValidationError) throw createError({ statusCode: 400, statusMessage: error.message })
    throw error
  }
})
