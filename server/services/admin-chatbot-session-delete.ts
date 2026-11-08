/**
 * Deleting visitor chat sessions (`DELETE /api/admin/chatbot/sessions/:id`,
 * `POST /api/admin/chatbot/sessions/bulk-delete`) — the deletes and their audit row, moved out of
 * the handlers verbatim, still in one transaction each (2026-11-08: no `server/api` file calls
 * getDb() itself). The handlers keep the permission, validating the ids, the existence read's
 * 404 (`findChatSessionById`), the admin's IP and the `logInfo` after the commit.
 *
 * Same resource as the READ side (`chat_sessions`): filtering /admin/users/activity by it must
 * show the deletions next to the views. The audit row says WHETHER contact data went with the
 * deletion (`hasContact`), never the data itself.
 */
import { createError } from 'h3'
import { and, count, eq, inArray, isNotNull, or } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { activityLogs, chatSessions, chatMessages } from '../db/schema'
import { affectedRowsOrZero, readAffectedRows } from '../utils/affected-rows'

/**
 * [id]/index.delete: delete the session's messages and the session (counted — 0 rows is a 404,
 * nothing recorded), and write the audit row, in one transaction. `session` is the row the
 * handler read before (its message count and whether it carried contact details).
 */
export async function deleteChatSessionWithAudit(
  adminUser: { id: number },
  sessionId: string,
  session: { messageCount: number, detectedPhone: string | null, detectedName: string | null },
  ip: string,
) {
  const db = getDb()
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

    // Delete session — counted: another delete or the retention purge may have taken it since the
    // read above, and a second "delete" audit row for a conversation this request did not remove
    // is a record of nothing (FINDING-R7-12, the R6-10 rule). 0 rows → 404, nothing recorded.
    const [deleted] = await tx.delete(chatSessions).where(eq(chatSessions.id, sessionId))
    if (readAffectedRows(deleted) !== 1) {
      throw createError({ statusCode: 404, message: 'Chat session not found' })
    }

    await tx.insert(activityLogs).values({
      userId: adminUser.id,
      action: 'delete',
      resource: 'chat_sessions',
      meta: {
        sessionId,
        messageCount: session.messageCount,
        hasContact: Boolean(session.detectedPhone || session.detectedName),
        ip,
      },
    })
  })
}

/**
 * bulk-delete.post: count the listed sessions that carry contact details, then delete their
 * messages and the sessions and write the audit row in one transaction; the number of sessions
 * actually deleted.
 */
export async function bulkDeleteChatSessionsWithAudit(adminUser: { id: number }, ids: string[], ip: string) {
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
        ip,
      },
    })

    return count
  })
  return deletedCount
}
