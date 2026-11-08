/**
 * The writes of "activate a pending factor" (`POST /api/admin/profile/mfa/confirm`), moved out of
 * the handler verbatim (2026-11-08: no `server/api` file calls getDb() itself).
 *
 * The handler keeps the checks and their order (factor type allowlist, a pending row exists, the
 * enrollment window, the code / second-tier password, the MFA policy and the recovery-code batch
 * hashed BEFORE the transaction) and — the reason this endpoint is NOT one transaction — the
 * sequence after it:
 *
 *   activatePendingFactor (one transaction)  →  revokeSessions  →  setSessionCookie(event, …)
 *   →  auditMfaFactorEnabled (pool)
 *
 * The session cookie is written between the activation and the audit row. A cookie is a side
 * effect on the response that no rollback can retract, so wrapping the audit in the activation's
 * transaction would hand the browser a session for an activation that was rolled back. The order
 * is pinned in `tests/reader-audit-atomicity.test.ts` (cookie-between-writes endpoints).
 *
 * Every statement here is guarded by the pending snapshot the handler read (`row`): a concurrent
 * enrollment that replaced the secret, the emailed code or the window makes the write match no
 * row, rather than act on the newer pending factor.
 */
import { createError } from 'h3'
import { and, eq, gt, lt, sql } from 'drizzle-orm'
import { readAffectedRows } from '../utils/affected-rows'
import { getDb } from '../utils/db'
import { userMfaFactors, userRecoveryCodes, activityLogs } from '../db/schema'
import { EMAIL_CODE_MAX_ATTEMPTS } from '../utils/mfa/codes'
import { countUnusedRecoveryCodes, type FactorRow, type FactorType } from '../utils/mfa/factors'
import { lockAccountForMfaChange, type PreparedRecoveryCodes } from '../utils/mfa/recovery-codes'

/** The pending row exactly as the handler read it. */
function pendingSnapshotOf(row: FactorRow) {
  return and(
    eq(userMfaFactors.id, row.id),
    eq(userMfaFactors.state, 'pending'),
    row.pendingExpiresAt ? eq(userMfaFactors.pendingExpiresAt, row.pendingExpiresAt) : undefined,
    row.secretCiphertext ? eq(userMfaFactors.secretCiphertext, row.secretCiphertext) : undefined,
    row.passwordHash ? eq(userMfaFactors.passwordHash, row.passwordHash) : undefined,
    row.pendingCodeHash ? eq(userMfaFactors.pendingCodeHash, row.pendingCodeHash) : undefined,
  )
}

/**
 * Drop the caller's own pending enrollment — the window lapsed, its stored secret will not open,
 * or the emailed code was missed too often — rather than letting a stale secret sit in the database
 * indefinitely. The handler answers 4xx/500 right after; the row was never active.
 */
export async function discardPendingFactor(row: FactorRow) {
  const db = getDb()
  await db.delete(userMfaFactors).where(pendingSnapshotOf(row))
}

/** A wrong emailed code: count the attempt (capped), leaving the factor pending and inactive. */
export async function countWrongPendingCode(row: FactorRow) {
  const db = getDb()
  await db
    .update(userMfaFactors)
    .set({ pendingCodeAttempts: sql`${userMfaFactors.pendingCodeAttempts} + 1` })
    .where(and(pendingSnapshotOf(row), lt(userMfaFactors.pendingCodeAttempts, EMAIL_CODE_MAX_ATTEMPTS)))
}

/**
 * Bật yếu tố và chèn lô mã là MỘT đơn vị (kiểm chứng độc lập 2A, W1):
 *  - chèn mã hỏng → cả lượt hoàn tác, yếu tố vẫn `pending` để thử lại (bản trước
 *    để lại một yếu tố đang bật mà không mã, và lượt thử lại thì báo "không có yêu
 *    cầu đang chờ");
 *  - khoá hàng `users` của tài khoản (`lockAccountForMfaChange`) tuần tự hoá các
 *    lượt bật/tạo lại đồng thời: lượt sau thấy lô của lượt trước và không chèn —
 *    một lô đang có (tờ mã đã hiện/in) KHÔNG BAO GIỜ bị thay bởi lượt bật yếu tố.
 * Thu hồi phiên + cookie + audit đi SAU (ngoại lệ có tên ở reader-audit-atomicity:
 * cookie nằm giữa hai lượt ghi).
 *
 * `prepared`: the batch the handler hashed before the transaction when the MFA policy covers the
 * account, else null. Returns the readable codes when this activation inserted them (shown once),
 * else null.
 */
export async function activatePendingFactor(params: {
  admin: { id: number }
  row: FactorRow
  factorType: FactorType
  acceptedStep: number | null
  prepared: PreparedRecoveryCodes | null
}): Promise<string[] | null> {
  const { admin, row, factorType, acceptedStep, prepared } = params
  const db = getDb()
  const pendingSnapshot = pendingSnapshotOf(row)
  // `as`: gán trong callback — không để TS thu hẹp thành `null` sau lượt await.
  let recoveryCodes = null as string[] | null
  await db.transaction(async (tx) => {
    await lockAccountForMfaChange(tx, admin.id)
    const activated = await tx
      .update(userMfaFactors)
      .set({
        state: 'active',
        pendingExpiresAt: null,
        pendingCodeHash: null,
        pendingCodeExpiresAt: null,
        pendingCodeAttempts: 0,
        lastAcceptedStep: acceptedStep,
        lastUsedAt: new Date(),
      })
      .where(and(
        pendingSnapshot,
        gt(userMfaFactors.pendingExpiresAt, new Date()),
        factorType === 'email_otp' ? gt(userMfaFactors.pendingCodeExpiresAt, new Date()) : undefined,
        factorType === 'email_otp' ? lt(userMfaFactors.pendingCodeAttempts, EMAIL_CODE_MAX_ATTEMPTS) : undefined,
      ))
    if (readAffectedRows(activated) !== 1) {
      throw createError({ statusCode: 409, statusMessage: 'Yêu cầu xác thực đã thay đổi hoặc hết hạn. Vui lòng thử lại.' })
    }
    if (prepared && (await countUnusedRecoveryCodes(admin.id, tx)) === 0) {
      await tx.insert(userRecoveryCodes).values(prepared.rows)
      recoveryCodes = prepared.codes
    }
  })
  return recoveryCodes
}

/**
 * The `profile_mfa:update` row of an activation — on the pool, AFTER the session cookie (see the
 * file header). Factor type only — no secret, no code, no hash; recovery codes: the count only.
 */
export async function auditMfaFactorEnabled(adminId: number, meta: { factorType: FactorType, enabled: boolean, ip: string, recoveryCodesGenerated?: number }) {
  const db = getDb()
  await db.insert(activityLogs).values({
    userId: adminId,
    action: 'update',
    resource: 'profile_mfa',
    resourceId: adminId,
    meta,
  })
}
