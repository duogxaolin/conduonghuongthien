import { eq } from 'drizzle-orm'
import { getDb } from '../../../../../utils/db'
import { activityLogs, chatSessions, chatMessages } from '../../../../../db/schema'
import { requireResourcePermission } from '../../../../../utils/permissions'
import { getClientIp } from '../../../../../utils/client-ip'
import { logInfo } from '../../../../../utils/logger'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'chatbot_knowledge', 'delete')
  const sessionId = getRouterParam(event, 'id')

  if (!sessionId) {
    throw createError({ statusCode: 400, message: 'Session ID is required' })
  }

  const db = getDb()

  // Fetch session before deletion for audit trail
  const [session] = await db.select().from(chatSessions).where(eq(chatSessions.id, sessionId)).limit(1)

  if (!session) {
    throw createError({ statusCode: 404, message: 'Chat session not found' })
  }

  /**
   * The deletes and the audit line commit together, or neither does. This row
   * carries a citizen's chat transcript — a phone number, sometimes a name, and
   * whatever they asked. Written unwrapped, a failed audit insert leaves the
   * conversation gone with nothing recording who removed it, which is exactly
   * the asymmetry the read side (`sessions/index.get.ts`) already guards
   * against: viewing this list writes an audit row, so deleting from it must
   * too. Runs on `tx`, not `db` — a `db.insert()` inside a transaction block
   * still commits independently on the pool.
   */
  await db.transaction(async (tx) => {
    // Delete messages first (foreign key constraint)
    await tx.delete(chatMessages).where(eq(chatMessages.sessionId, sessionId))

    // Delete session
    await tx.delete(chatSessions).where(eq(chatSessions.id, sessionId))

    await tx.insert(activityLogs).values({
      userId: adminUser.id,
      action: 'delete',
      resource: 'chat_sessions',
      meta: {
        sessionId,
        messageCount: session.messageCount,
        hasContact: Boolean(session.detectedPhone || session.detectedName),
        ip: getClientIp(event),
      },
    })
  })

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
