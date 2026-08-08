import { affectedRowsOrZero } from '../../../../utils/affected-rows'
import { and, count, inArray, isNotNull, or } from 'drizzle-orm'
import { getDb } from '../../../../utils/db'
import { activityLogs, chatSessions, chatMessages } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'
import { getClientIp } from '../../../../utils/client-ip'
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

  /**
   * Counted before anything is deleted — after the rows are gone this is the only
   * way left to know whether any of them carried a citizen's contact details.
   *
   * Destructured with a default, matching `articles/index.get.ts`: an aggregate
   * always returns one row in practice, but the type is an array and a bare
   * `const [{ contactCount }] =` throws `TypeError` on an empty one. Typecheck
   * caught exactly that here.
   */
  const [{ contactCount } = { contactCount: 0 }] = await db
    .select({ contactCount: count() })
    .from(chatSessions)
    .where(and(
      inArray(chatSessions.id, ids),
      or(isNotNull(chatSessions.detectedPhone), isNotNull(chatSessions.detectedName)),
    ))

  /**
   * The deletes and the audit line commit together, or neither does — same
   * asymmetry as the single-session delete: the read side (`sessions/index.get.ts`)
   * already writes an audit row for viewing this list, so a bulk delete from it
   * must too. Runs on `tx`, not `db` — a `db.insert()` inside a transaction block
   * still commits independently on the pool.
   */
  const deletedCount = await db.transaction(async (tx) => {
    // Delete messages first (foreign key constraint)
    await tx.delete(chatMessages).where(inArray(chatMessages.sessionId, ids))

    // Delete sessions
    const deleted = await tx.delete(chatSessions).where(inArray(chatSessions.id, ids))

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
    const count = affectedRowsOrZero(header)

    await tx.insert(activityLogs).values({
      userId: adminUser.id,
      action: 'delete',
      resource: 'chat_sessions',
      meta: {
        requestedCount: ids.length,
        deletedCount: count,
        hasContact: contactCount > 0,
        ip: getClientIp(event),
      },
    })

    return count
  })

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
