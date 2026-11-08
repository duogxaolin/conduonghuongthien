/**
 * The database statements of "change your own password" (`PUT /api/admin/profile/password`), moved
 * out of the handler verbatim (2026-11-08: no `server/api` file calls getDb() itself). Every
 * statement is keyed on the session's account (`admin.id`) — never on anything in the body.
 *
 * The handler keeps the checks and the sequence:
 *
 *   findOwnPasswordRow  →  current password, project policy, "not the same password"  →
 *   updateOwnPassword (new hash + session generation +1)  →  clearRateLimit  →  readOwnTokenVersion
 *   →  setSessionCookie(event, …)  →  auditOwnPasswordChange (pool)
 *
 * The session cookie is re-issued between the update and the audit row, so the caller is not
 * logged out by their own change. A cookie is a side effect on the response that no rollback can
 * retract, so the pair is deliberately not one transaction (pinned in
 * `tests/reader-audit-atomicity.test.ts`, cookie-between-writes endpoints).
 */
import { eq, sql } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { users, activityLogs } from '../db/schema'

/** The middleware does not carry the hash, and must not. */
export async function findOwnPasswordRow(admin: { id: number }) {
  const db = getDb()
  const [row] = await db
    .select({ passwordHash: users.passwordHash, username: users.username })
    .from(users)
    .where(eq(users.id, admin.id))
    .limit(1)
  return row
}

/** Store the new hash (computed by the handler) and revoke every session minted under the old password. */
export async function updateOwnPassword(admin: { id: number }, passwordHash: string) {
  const db = getDb()
  await db
    .update(users)
    .set({
      passwordHash,
      // Revoke every session minted under the old password.
      tokenVersion: sql`${users.tokenVersion} + 1` as unknown as number,
    })
    .where(eq(users.id, admin.id))
}

/** Re-read the bumped generation, so the handler can re-issue this session's cookie. */
export async function readOwnTokenVersion(admin: { id: number }) {
  const db = getDb()
  const [fresh] = await db
    .select({ tokenVersion: users.tokenVersion })
    .from(users)
    .where(eq(users.id, admin.id))
    .limit(1)
  return fresh
}

/** The `profile_password:update` row — on the pool, AFTER the session cookie (see the file header). */
export async function auditOwnPasswordChange(admin: { id: number }, meta: { ip: string, userAgent: string }) {
  const db = getDb()
  await db.insert(activityLogs).values({
    userId: admin.id,
    action: 'update',
    resource: 'profile_password',
    resourceId: admin.id,
    meta,
  })
}
