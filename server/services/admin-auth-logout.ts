/**
 * The two writes of the admin logout (`POST /api/admin/auth/logout`), moved out of the handler
 * verbatim (2026-11-08: no `server/api` file calls getDb() itself), each still its own statement on
 * the pool — deliberately NOT one transaction.
 *
 * The handler keeps the order and the error handling: bump the session generation (its own
 * try/catch: a failure logs `auth.logout_token_invalidation_failed` and the logout carries on),
 * then the audit row (its own try/catch: a failure logs `auth.logout_audit_failed`), then
 * `deleteCookie(event, 'cdkt_admin', …)`. Both writes are best-effort and independent: wrapped in
 * one transaction, a failed audit insert would roll back the token invalidation — and the stolen
 * token would stay valid for the rest of its 8 h lifetime because the LOG failed.
 */
import { eq, sql } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { users, activityLogs } from '../db/schema'

/**
 * Invalidate the token itself, not just the cookie. Clearing the cookie
 * alone left a stolen token usable for the rest of its 8h lifetime; bumping
 * the user's token version makes every previously issued token fail the
 * check in server/middleware/admin-auth.ts immediately.
 * NOTE: this signs the account out on ALL devices — deliberate for an admin
 * panel, where "log me out" should mean everywhere.
 */
export async function bumpAdminTokenVersion(userId: number) {
  const db = getDb()
  await db.update(users)
    .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
    .where(eq(users.id, userId))
}

/** The `auth:logout` row — on the pool, after the bump (see the file header for why not one transaction). */
export async function auditAdminLogout(userId: number, meta: { ip: string }) {
  const db = getDb()
  await db.insert(activityLogs).values({
    userId,
    action: 'logout',
    resource: 'auth',
    meta,
  })
}
