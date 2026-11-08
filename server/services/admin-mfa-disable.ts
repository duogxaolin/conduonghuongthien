/**
 * The transaction of "turn a factor off" (`POST /api/admin/profile/mfa/disable`), moved out of the
 * handler verbatim (2026-11-08: no `server/api` file calls getDb() itself).
 *
 * The factor, the recovery codes it leaves without purpose, the session generation and the audit
 * row commit in ONE transaction; the handler writes the `mfa.factor_disabled` log line and the
 * session cookie AFTER the commit, so no HTTP side effect sits between the writes. The handler
 * keeps the factor type allowlist, re-proving the current password, and the 404 for a factor that
 * was never there.
 */
import { createError } from 'h3'
import { getDb } from '../utils/db'
import { activityLogs } from '../db/schema'
import {
  deleteFactor,
  hasAnyActiveFactor,
  pruneRecoveryCodesIfNoFactors,
  revokeSessions,
  type FactorType,
} from '../utils/mfa/factors'
import { lockAccountForMfaChange } from '../utils/mfa/recovery-codes'

/**
 * Delete the factor (0 rows → 404, rolled back), prune the recovery codes when no factor is left,
 * bump the session generation and write the audit row — one transaction. Returns whether another
 * active factor still protects the account, and the new session generation for the cookie.
 */
export async function disableFactorWithAudit(admin: { id: number }, factorType: FactorType, ip: string) {
  const db = getDb()
  // Every read and write on `tx`: a `getDb()` read here runs on another pool
  // connection and, on MySQL, would not see the uncommitted delete.
  return db.transaction(async (tx) => {
    // Serialises with enabling a factor / regenerating codes (`confirm.post.ts`) and
    // with a second disable, so "is any factor left" is decided on settled rows.
    await lockAccountForMfaChange(tx, admin.id)
    if ((await deleteFactor(admin.id, factorType, tx)) === 0) {
      throw createError({ statusCode: 404, statusMessage: 'Phương thức này chưa được bật.' })
    }
    // Recovery codes exist to get past a factor; with no factor left they are
    // material with no purpose.
    await pruneRecoveryCodesIfNoFactors(admin.id, tx)
    const remaining = await hasAnyActiveFactor(admin.id, tx)
    const version = await revokeSessions(admin.id, tx)
    await tx.insert(activityLogs).values({
      userId: admin.id,
      action: 'update',
      resource: 'profile_mfa',
      resourceId: admin.id,
      meta: { factorType, enabled: false, ip },
    })
    return { stillProtected: remaining, tokenVersion: version }
  })
}
