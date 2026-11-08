import { requireResourcePermission } from '../../../../../utils/permissions'
import { getClientIp } from '../../../../../utils/client-ip'
import { logInfo } from '../../../../../utils/logger'
import { findChatSessionById } from '../../../../../services/admin-chatbot-session-detail'
import { deleteChatSessionWithAudit } from '../../../../../services/admin-chatbot-session-delete'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'chatbot_knowledge', 'delete')
  const sessionId = getRouterParam(event, 'id')

  if (!sessionId) {
    throw createError({ statusCode: 400, message: 'Session ID is required' })
  }

  // Fetch session before deletion for audit trail
  const session = await findChatSessionById(sessionId)

  if (!session) {
    throw createError({ statusCode: 404, message: 'Chat session not found' })
  }

  // Messages, then the session (counted: 0 rows → 404, nothing recorded), then the audit row —
  // one transaction (services/admin-chatbot-session-delete.ts).
  await deleteChatSessionWithAudit(adminUser, sessionId, session, getClientIp(event))

  logInfo({
    event: 'chatbot.session_deleted',
    userId: adminUser.id,
    username: adminUser.username,
    sessionId,
    messageCount: session.messageCount,
    consequence: 'session and all messages permanently deleted',
  })

  return { ok: true, deleted: sessionId }
})
