/**
 * Issue and mail a one-time code for the email factor.
 *
 * The recipient is always the address stored on the account, never one supplied
 * in a request: an attacker holding a password must not be able to redirect the
 * second factor to their own inbox.
 */
import { and, eq, isNull } from 'drizzle-orm'
import { readAffectedRows } from '../affected-rows'
import { getDb } from '../db'
import { userMfaFactors } from '../../db/schema'
import { sendMail } from '../mailer'
import { EMAIL_CODE_TTL_MS, generateEmailCode, hashOneTimeCode } from './codes'

export type IssueOutcome =
  | { ok: true }
  | { ok: false; reason: 'no-email' | 'no-factor' | 'superseded' | 'smtp' }

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
  const [factor] = await db.select().from(userMfaFactors)
    .where(eq(userMfaFactors.id, params.factorId)).limit(1)
  const state = params.purpose === 'login' ? 'active' : 'pending'
  if (!factor || factor.factorType !== 'email_otp' || factor.state !== state) return { ok: false, reason: 'no-factor' }
  const issued = await db
    .update(userMfaFactors)
    .set({
      pendingCodeHash: await hashOneTimeCode(code),
      pendingCodeExpiresAt: new Date(Date.now() + EMAIL_CODE_TTL_MS),
      pendingCodeAttempts: 0,
    })
    .where(and(
      eq(userMfaFactors.id, params.factorId),
      eq(userMfaFactors.state, state),
      factor.pendingCodeHash === null
        ? isNull(userMfaFactors.pendingCodeHash)
        : eq(userMfaFactors.pendingCodeHash, factor.pendingCodeHash),
    ))
  // Concurrent issuers that read the same generation must not both mail a code
  // while silently overwriting one another. The loser can retry explicitly.
  if (readAffectedRows(issued) !== 1) return { ok: false, reason: 'superseded' }

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
