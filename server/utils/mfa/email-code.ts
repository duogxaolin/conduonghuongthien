/**
 * Issue and mail a one-time code for the email factor.
 *
 * The recipient is always the address stored on the account, never one supplied
 * in a request: an attacker holding a password must not be able to redirect the
 * second factor to their own inbox.
 */
import { eq } from 'drizzle-orm'
import { getDb } from '../db'
import { userMfaFactors } from '../../db/schema'
import { sendMail } from '../mailer'
import { EMAIL_CODE_TTL_MS, generateEmailCode, hashOneTimeCode } from './codes'

export type IssueOutcome =
  | { ok: true }
  | { ok: false; reason: 'no-email' | 'no-factor' | 'smtp' }

/**
 * Generates a fresh code, replaces any outstanding one (so only the newest works),
 * and mails it. The attempt counter resets with the new code.
 */
export async function issueEmailCode(params: {
  factorId: number
  email: string | null
  username: string
  purpose: 'login' | 'enroll'
}): Promise<IssueOutcome> {
  if (!params.email) return { ok: false, reason: 'no-email' }

  const code = generateEmailCode()
  const db = getDb()
  await db
    .update(userMfaFactors)
    .set({
      pendingCodeHash: await hashOneTimeCode(code),
      pendingCodeExpiresAt: new Date(Date.now() + EMAIL_CODE_TTL_MS),
      pendingCodeAttempts: 0,
    })
    .where(eq(userMfaFactors.id, params.factorId))

  const minutes = Math.round(EMAIL_CODE_TTL_MS / 60000)
  const subject = params.purpose === 'enroll'
    ? 'Mã xác nhận bật xác thực hai bước — Cổng quản trị CDKT'
    : 'Mã xác thực đăng nhập — Cổng quản trị CDKT'
  const intro = params.purpose === 'enroll'
    ? 'Bạn đang bật phương thức xác thực bằng mã gửi về email cho tài khoản quản trị'
    : 'Bạn đang đăng nhập vào cổng quản trị với tài khoản'

  try {
    await sendMail({
      to: params.email,
      subject,
      text: [
        `${intro} ${params.username}.`,
        '',
        `Mã xác thực: ${code}`,
        `Mã có hiệu lực trong ${minutes} phút và chỉ dùng được một lần.`,
        '',
        'Nếu bạn không thực hiện yêu cầu này, hãy đổi mật khẩu quản trị ngay.',
      ].join('\n'),
    })
  } catch {
    // The code is already stored. Leaving it there is harmless (it expires) and
    // clearing it would race a delivery that actually succeeded late.
    return { ok: false, reason: 'smtp' }
  }
  return { ok: true }
}
