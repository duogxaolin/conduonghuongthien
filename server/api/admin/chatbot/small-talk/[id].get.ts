import { getSmallTalk, adminSmallTalk } from '../../../../services/chatbot-small-talk'
import { requireChatbotSmallTalkPermission } from '../../../../utils/permissions'

export default defineEventHandler(async (event) => {
  requireChatbotSmallTalkPermission(event, 'read')
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isSafeInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: 'Invalid small-talk ID' })
  const item = await getSmallTalk(id)
  if (!item) throw createError({ statusCode: 404, statusMessage: 'Small-talk entry not found' })
  return { ok: true, item: adminSmallTalk(item) }
})
