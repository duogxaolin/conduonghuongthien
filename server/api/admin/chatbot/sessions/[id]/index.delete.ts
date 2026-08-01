import { eq } from 'drizzle-orm'
import { getDb } from '../../../../../utils/db'
import { chatSessions, chatMessages } from '../../../../../db/schema'
import { requireResourcePermission } from '../../../../../utils/permissions'
import { logInfo } from '../../../../../utils/logger'

export default defineEventHandler(async (event) => {
  const adminUser = await requireResourcePermission(event, 'chatbot_knowledge', 'delete')
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

  // Delete messages first (foreign key constraint)
  await db.delete(chatMessages).where(eq(chatMessages.sessionId, sessionId))

  // Delete session
  await db.delete(chatSessions).where(eq(chatSessions.id, sessionId))

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
