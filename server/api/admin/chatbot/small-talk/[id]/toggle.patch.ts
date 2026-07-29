import { getSmallTalk, setSmallTalkEnabled, adminSmallTalk } from '../../../../../services/chatbot-small-talk'
import { requireChatbotSmallTalkPermission } from '../../../../../utils/permissions'

/**
 * Flip a single entry's enabled flag. Toggling is an `update` on this store
 * (no publish lifecycle). System rows can be toggled — only deletion is blocked.
 */
export default defineEventHandler(async (event) => {
  const actor = requireChatbotSmallTalkPermission(event, 'update')
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isSafeInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: 'Invalid small-talk ID' })
  const current = await getSmallTalk(id)
  if (!current) throw createError({ statusCode: 404, statusMessage: 'Small-talk entry not found' })
  const item = await setSmallTalkEnabled(actor.id, id, !current.isEnabled)
  return { ok: true, item: adminSmallTalk(item) }
})
