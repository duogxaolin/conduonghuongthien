import { inArray } from 'drizzle-orm'
import { getDb } from '../../../../utils/db'
import { chatSessions, chatMessages } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'
import { logInfo } from '../../../../utils/logger'

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

  const db = getDb()

  // Delete messages first (foreign key constraint)
  await db.delete(chatMessages).where(inArray(chatMessages.sessionId, ids))

  // Delete sessions
  const result = await db.delete(chatSessions).where(inArray(chatSessions.id, ids))

  const deletedCount = Number((result as unknown as { affectedRows?: number }).affectedRows || 0)

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
