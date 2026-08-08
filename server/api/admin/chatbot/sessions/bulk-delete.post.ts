import { affectedRowsOrZero } from '../../../../utils/affected-rows'
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
  const deleted = await db.delete(chatSessions).where(inArray(chatSessions.id, ids))

  /**
   * Destructured. `db.delete()` resolves to `[ResultSetHeader, FieldPacket[]]`,
   * so `.affectedRows` read off the array itself is `undefined` — and
   * `Number(undefined || 0)` is `0`, silently.
   *
   * This was live: the officer saw "0 deleted" after removing real conversations,
   * the audit line recorded `deletedCount: 0` alongside a `consequence` sentence
   * claiming zero rows went, and the rows were gone regardless. A destroyed record
   * whose only trace says nothing was destroyed is the exact failure the audit log
   * exists to prevent.
   *
   * Same trap as callback.get.ts, ip-bans.ts, createComment and createAdminReply.
   * `as unknown as { affectedRows?: number }` is what hid it: the cast asserts the
   * shape instead of checking it, so typecheck, a fake pool and every source-text
   * test all agreed with the wrong reading. Guarded by
   * tests/insert-id-integration.test.ts.
   */
  const [header] = deleted
  const deletedCount = affectedRowsOrZero(header)

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
