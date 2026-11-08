/**
 * The audit row of "turn recovery codes on / regenerate them" (`POST
 * /api/admin/profile/mfa/recovery-codes`), moved out of the handler verbatim (2026-11-08: no
 * `server/api` file calls getDb() itself).
 *
 * The handler keeps the sequence, and the sequence is why this row is NOT in a transaction with
 * the writes before it:
 *
 *   issueRecoveryCodes (utils/mfa/recovery-codes.ts, its own transaction)  →  revokeSessions
 *   →  setSessionCookie(event, …)  →  auditRecoveryCodesGenerated (pool)
 *
 * The session cookie is written between the writes. A cookie is a side effect on the response that
 * no rollback can retract (pinned in `tests/reader-audit-atomicity.test.ts`, cookie-between-writes
 * endpoints). The codes themselves never reach the log: the count only.
 */
import { getDb } from '../utils/db'
import { activityLogs } from '../db/schema'

/** The `profile_recovery_codes:update` row of a (re)generation — on the pool, AFTER the session cookie. */
export async function auditRecoveryCodesGenerated(adminId: number, meta: { generated: number, ip: string }) {
  const db = getDb()
  await db.insert(activityLogs).values({
    userId: adminId,
    action: 'update',
    resource: 'profile_recovery_codes',
    resourceId: adminId,
    // Count only — the codes themselves never touch the log.
    meta,
  })
}
