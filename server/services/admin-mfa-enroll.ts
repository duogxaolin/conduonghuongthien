/**
 * The write of "begin enrolling a factor" (`POST /api/admin/profile/mfa/enroll`), moved out of the
 * handler verbatim (2026-11-08: no `server/api` file calls getDb() itself) — the handler's
 * `storePending` closure, now taking the row it read (`existing`) as an argument.
 *
 * The handler keeps everything around it: the factor type allowlist, re-proving the current
 * password, refusing to re-enroll an active factor, the TOTP secret (sealed at rest, returned once),
 * the SMTP and stored-address checks of the emailed code, the second-tier password policy, and the
 * values written. One statement per call, on the pool, no transaction — as before; for the emailed
 * code the handler then re-reads the row and `issueEmailCode` writes the code hash on its own.
 */
import { createError } from 'h3'
import { and, eq } from 'drizzle-orm'
import { readAffectedRows } from '../utils/affected-rows'
import { getDb } from '../utils/db'
import { userMfaFactors } from '../db/schema'

/**
 * Write the pending row: insert when the caller had none, otherwise replace the pending one —
 * never an active one (409).
 */
export async function storePendingFactor(existing: { id: number } | null, values: typeof userMfaFactors.$inferInsert) {
  const db = getDb()
  if (!existing) {
    await db.insert(userMfaFactors).values(values)
    return
  }
  // A concurrent confirmation may have activated the row since our read.
  // Re-enrollment must never downgrade that active protection to pending.
  const replaced = await db.update(userMfaFactors).set(values).where(and(
    eq(userMfaFactors.id, existing.id), eq(userMfaFactors.state, 'pending'),
  ))
  if (readAffectedRows(replaced) !== 1) {
    throw createError({ statusCode: 409, statusMessage: 'Phương thức xác thực đã thay đổi. Vui lòng tải lại trang.' })
  }
}
