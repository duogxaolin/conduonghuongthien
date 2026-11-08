/**
 * Break-glass (`DELETE /api/admin/users/:id/mfa`) — its queries, moved out of the handler
 * verbatim. The SuperAdmin-only gate, the 404, the client IP, the security log line and the
 * response stay in the handler; nothing here decides who may call it.
 */
import { eq, sql } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { users, roles, userMfaFactors, userRecoveryCodes, activityLogs } from '../db/schema'

/** The account whose factors are to be cleared, with its role name; undefined if absent. */
export async function findMfaResetTarget(id: number) {
  const db = getDb()
  const [target] = await db
    .select({ id: users.id, username: users.username, roleName: roles.name })
    .from(users)
    .leftJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.id, id))
    .limit(1)
  return target
}

/** Clear account `id`'s factors and recovery codes, revoke its sessions, audit both sides. */
export async function clearUserMfaFactors(admin: { id: number, username: string }, id: number, target: { username: string }, ip: string) {
  const db = getDb()

  /**
   * Four writes, one commit.
   *
   * This is the single action that can undo another administrator's
   * authentication hardening, so a partial application is the worst possible
   * outcome: factors cleared but sessions still live, or — the case that matters
   * most — every trace of the override removed while the override itself stands.
   * `activity_logs.user_id` is a foreign key and `meta` is JSON, so the audit
   * insert has its own ways to fail independently of the deletes above it.
   *
   * The session bump is inlined on `tx` (the `tokenVersion + 1` update below)
   * rather than a call to `revokeSessions()`: when this was written that helper
   * always opened its own `getDb()` handle and could not join a transaction.
   * Since 2026-10-28 it takes an optional executor (`revokeSessions(id, tx)`, as
   * `profile/mfa/disable.post.ts` uses it); the inline statement is equivalent
   * and stays, pinned by `tests/mfa-codes-endpoints.test.ts`. Everything runs on
   * `tx` rather than `db` — a `db.insert()`
   * sitting inside a transaction block still commits on the pool independently,
   * which is this same bug wearing a transaction's clothes.
   */
  await db.transaction(async (tx) => {
    await tx.delete(userMfaFactors).where(eq(userMfaFactors.userId, id))
    await tx.delete(userRecoveryCodes).where(eq(userRecoveryCodes.userId, id))
    // The target's live sessions go too: whoever prompted this cannot be assumed
    // to be the only party holding one.
    await tx
      .update(users)
      .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.id, id))

    // Two rows: one against the actor, one against the target, so the act is
    // visible from either account's history.
    await tx.insert(activityLogs).values([
      {
        userId: admin.id,
        action: 'delete',
        resource: 'user_mfa',
        resourceId: id,
        meta: { targetUsername: target.username, ip },
      },
      {
        userId: id,
        action: 'delete',
        resource: 'user_mfa',
        resourceId: id,
        meta: { clearedBy: admin.username, ip },
      },
    ])
  })
}
