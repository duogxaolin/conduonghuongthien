/**
 * The transaction of "turn recovery codes off" (`DELETE /api/admin/profile/mfa/recovery-codes`),
 * moved out of the handler verbatim (2026-11-08: no `server/api` file calls getDb() itself). The
 * handler keeps re-proving the current password, the admin's IP, the read of the factors still
 * usable (outside the transaction — it reads `user_mfa_factors`, which this never touches) and
 * the lockout warning of the response.
 */
import { getDb } from '../utils/db'
import { activityLogs } from '../db/schema'
import { deleteAllRecoveryCodes } from '../utils/mfa/factors'

/**
 * The deletion and its audit row commit together. Unlike the sibling
 * enable/confirm endpoints, nothing here writes an HTTP cookie between the two
 * — so there is no side effect a rollback could fail to retract, and no reason
 * to leave the pair split. Recovery codes are the last way back into a locked
 * account: if the audit insert failed after an unwrapped delete, every code
 * would be gone with nothing recording who removed them.
 */
export async function clearRecoveryCodesWithAudit(admin: { id: number }, ip: string) {
  const db = getDb()
  await db.transaction(async (tx) => {
    await deleteAllRecoveryCodes(admin.id, tx)
    await tx.insert(activityLogs).values({
      userId: admin.id,
      action: 'update',
      resource: 'profile_recovery_codes',
      resourceId: admin.id,
      meta: { generated: 0, cleared: true, ip },
    })
  })
}
