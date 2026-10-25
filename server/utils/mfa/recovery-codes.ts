/**
 * Mã dự phòng — MỘT nơi duy nhất quyết định mã được sinh, băm và lưu thế nào. Hai
 * nơi gọi:
 *  - `profile/mfa/recovery-codes.post.ts` — cán bộ tự tạo/tạo lại (`issueRecoveryCodes`);
 *  - `profile/mfa/confirm.post.ts` — bật yếu tố khi chính sách MFA khác `off` và
 *    tài khoản chưa có lô nào (spec admin-mfa-policy, quyết định D1): dùng
 *    `prepareRecoveryCodes` + `lockAccountForMfaChange` để bật yếu tố và chèn lô
 *    mã trong CÙNG transaction.
 *
 * Mọi thay đổi vật liệu MFA của một tài khoản giữ khoá hàng `users` của nó
 * (`SELECT … FOR UPDATE`) tới hết transaction. Không có khoá này, hai lượt xác nhận
 * yếu tố đồng thời cùng thấy "chưa có lô", cùng chèn — và lượt tạo lại chen giữa
 * xoá mất tờ mã một phản hồi vừa hiện (kiểm chứng độc lập 2A, W1).
 *
 * Lô cũ bị XOÁ hẳn khi tạo lại (không chỉ đổi batch id) để một tờ mã cũ bị lộ không
 * còn đổi được. Trả mã ở dạng đọc được — lần DUY NHẤT chúng tồn tại ngoài bcrypt.
 * Nơi gọi trả chúng trong phản hồi và không bao giờ ghi vào log hay `activity_logs`.
 */
import { eq } from 'drizzle-orm'
import { getDb } from '../db'
import { userRecoveryCodes, users } from '../../db/schema'
import {
  RECOVERY_CODE_COUNT,
  generateBatchId,
  generateRecoveryCodes,
  hashOneTimeCode,
  normalizeRecoveryCode,
} from './codes'
import { deleteAllRecoveryCodes } from './factors'

export interface PreparedRecoveryCodes {
  /** Dạng đọc được — chỉ để trả trong phản hồi. */
  codes: string[]
  /** Hàng để chèn (đã băm). */
  rows: Array<{ userId: number, codeHash: string, batchId: string }>
}

/**
 * Sinh + băm một lô. Gọi TRƯỚC khi mở transaction: bcrypt chậm (~10 lượt băm), không
 * được giữ kết nối và khoá hàng trong lúc đó.
 */
export async function prepareRecoveryCodes(userId: number): Promise<PreparedRecoveryCodes> {
  const codes = generateRecoveryCodes(RECOVERY_CODE_COUNT)
  const batchId = generateBatchId()
  const rows = await Promise.all(codes.map(async code => ({
    userId,
    // Hashed over the normalized form so the separator is irrelevant at redemption.
    codeHash: await hashOneTimeCode(normalizeRecoveryCode(code)),
    batchId,
  })))
  return { codes, rows }
}

type LockExecutor = Pick<ReturnType<typeof getDb>, 'select'>

/**
 * Khoá hàng `users` của tài khoản tới hết transaction đang mở — tuần tự hoá mọi
 * thay đổi vật liệu MFA của tài khoản đó (bật yếu tố, tạo lại mã).
 */
export async function lockAccountForMfaChange(executor: LockExecutor, userId: number): Promise<void> {
  await executor.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1).for('update')
}

/** Tạo (lại) lô mã: xoá lô cũ + chèn lô mới trong một transaction, dưới khoá tài khoản. */
export async function issueRecoveryCodes(userId: number): Promise<string[]> {
  const prepared = await prepareRecoveryCodes(userId)
  await getDb().transaction(async (tx) => {
    await lockAccountForMfaChange(tx, userId)
    await deleteAllRecoveryCodes(userId, tx)
    await tx.insert(userRecoveryCodes).values(prepared.rows)
  })
  return prepared.codes
}
