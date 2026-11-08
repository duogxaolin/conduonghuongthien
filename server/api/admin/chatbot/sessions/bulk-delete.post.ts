import { requireResourcePermission } from '../../../../utils/permissions'
import { getClientIp } from '../../../../utils/client-ip'
import { logInfo } from '../../../../utils/logger'
import { bulkDeleteChatSessionsWithAudit } from '../../../../services/admin-chatbot-session-delete'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'chatbot_knowledge', 'delete')
  const body = await readBody(event)

  if (!body?.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
    throw createError({ statusCode: 400, message: 'Session IDs required' })
  }

  const ids = body.ids.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)

  if (ids.length === 0) {
    throw createError({ statusCode: 400, message: 'No valid session IDs provided' })
  }

  if (ids.length > 100) {
    throw createError({ statusCode: 400, message: 'Maximum 100 sessions per request' })
  }

  // Contact details counted first, then messages + sessions + the audit row in one transaction
  // (services/admin-chatbot-session-delete.ts).
  const deletedCount = await bulkDeleteChatSessionsWithAudit(adminUser, ids, getClientIp(event))

  logInfo({
    event: 'chatbot.sessions_bulk_deleted',
    userId: adminUser.id,
    username: adminUser.username,
    requestedCount: ids.length,
    deletedCount,
    consequence: `${deletedCount} sessions and their messages permanently deleted`,
  })

  return { ok: true, deleted: deletedCount }
})
