/**
 * Phát một lô mã dự phòng mới cho một tài khoản — MỘT nơi duy nhất quyết định mã
 * được sinh, băm và lưu thế nào. Hai nơi gọi:
 *  - `profile/mfa/recovery-codes.post.ts` — cán bộ tự tạo/tạo lại;
 *  - `profile/mfa/confirm.post.ts` — bật yếu tố khi chính sách MFA khác `off`
 *    và tài khoản chưa có lô nào (spec admin-mfa-policy, quyết định D1).
 *
 * Lô cũ bị XOÁ hẳn (không chỉ đổi batch id) để một tờ mã cũ bị lộ không còn đổi
 * được. Xoá + chèn trong một transaction: hỏng giữa chừng thì lô cũ còn nguyên,
 * không bao giờ còn lại một tài khoản không mã nào mà người dùng tưởng đã có.
 *
 * Trả mã ở dạng đọc được — lần DUY NHẤT chúng tồn tại ngoài bcrypt. Nơi gọi trả
 * chúng trong phản hồi và không bao giờ ghi vào log hay `activity_logs`.
 */
import { getDb } from '../db'
import { userRecoveryCodes } from '../../db/schema'
import {
  RECOVERY_CODE_COUNT,
  generateBatchId,
  generateRecoveryCodes,
  hashOneTimeCode,
  normalizeRecoveryCode,
} from './codes'
import { deleteAllRecoveryCodes } from './factors'

export async function issueRecoveryCodes(userId: number): Promise<string[]> {
  const codes = generateRecoveryCodes(RECOVERY_CODE_COUNT)
  const batchId = generateBatchId()
  // Băm TRƯỚC khi mở transaction: bcrypt chậm, không giữ kết nối trong lúc đó.
  const rows = await Promise.all(codes.map(async code => ({
    userId,
    // Hashed over the normalized form so the separator is irrelevant at redemption.
    codeHash: await hashOneTimeCode(normalizeRecoveryCode(code)),
    batchId,
  })))

  await getDb().transaction(async (tx) => {
    await deleteAllRecoveryCodes(userId, tx)
    await tx.insert(userRecoveryCodes).values(rows)
  })
  return codes
}
