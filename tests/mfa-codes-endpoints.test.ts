/**
 * One-time code primitives (real behaviour) plus the wiring contracts of the
 * self-service endpoints.
 *
 * The primitives are pure and get exercised for real. The endpoints each open a
 * database connection on import, so they are pinned by reading their source: that
 * proves a guard has not been deleted, not that it runs. The integration side of
 * these paths is covered by the `*-ddl-integration` suites against a real MySQL.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  EMAIL_CODE_DIGITS,
  EMAIL_CODE_MAX_ATTEMPTS,
  EMAIL_CODE_TTL_MS,
  ENROLLMENT_TTL_MS,
  RECOVERY_CODE_COUNT,
  constantTimeEqual,
  generateBatchId,
  generateEmailCode,
  generateRecoveryCode,
  generateRecoveryCodes,
  hashOneTimeCode,
  isExpired,
  normalizeRecoveryCode,
  verifyOneTimeCode,
} from '../server/utils/mfa/codes'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative: string) => readFileSync(join(root, relative), 'utf8')

// ── Email one-time codes ─────────────────────────────────────────────────────

test('an email code is exactly six digits, zero-padded rather than shortened', () => {
  for (let i = 0; i < 500; i++) {
    const code = generateEmailCode()
    assert.equal(code.length, EMAIL_CODE_DIGITS)
    assert.match(code, /^[0-9]{6}$/)
  }
})

test('email codes vary — a constant generator would pass a shape check', () => {
  const seen = new Set(Array.from({ length: 200 }, () => generateEmailCode()))
  assert.ok(seen.size > 100, `expected spread across the 10^6 space, saw ${seen.size} distinct`)
})

test('a one-time code is stored as a bcrypt hash, never as itself', async () => {
  const code = generateEmailCode()
  const hash = await hashOneTimeCode(code)
  assert.notEqual(hash, code)
  assert.ok(!hash.includes(code), 'the code must not be recoverable from the stored value')
  assert.match(hash, /^\$2[aby]\$/, 'expected a bcrypt hash')
  assert.equal(await verifyOneTimeCode(code, hash), true)
})

test('a wrong code fails against the stored hash', async () => {
  const hash = await hashOneTimeCode('123456')
  assert.equal(await verifyOneTimeCode('123457', hash), false)
  assert.equal(await verifyOneTimeCode('', hash), false)
})

test('the code lifetime and attempt ceiling are both bounded', () => {
  assert.equal(EMAIL_CODE_TTL_MS, 10 * 60 * 1000)
  assert.equal(EMAIL_CODE_MAX_ATTEMPTS, 5)
  assert.equal(ENROLLMENT_TTL_MS, 15 * 60 * 1000)
})

test('expiry treats a missing timestamp as expired rather than as forever', () => {
  const now = Date.now()
  assert.equal(isExpired(null, now), true, 'absent expiry must fail closed')
  assert.equal(isExpired(undefined, now), true)
  assert.equal(isExpired(new Date(now - 1), now), true)
  assert.equal(isExpired(new Date(now), now), true, 'the boundary instant is spent')
  assert.equal(isExpired(new Date(now + 1000), now), false)
})

// ── Recovery codes ───────────────────────────────────────────────────────────

test('a recovery code carries 50 bits from an unambiguous alphabet', () => {
  for (let i = 0; i < 200; i++) {
    const code = generateRecoveryCode()
    assert.match(code, /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/)
    // I, O, 0 and 1 are excluded so a code read aloud cannot be mistranscribed.
    assert.ok(!/[IO01]/.test(code), `ambiguous character in ${code}`)
  }
})

test('a generated batch has the declared size and no duplicates', () => {
  const codes = generateRecoveryCodes()
  assert.equal(codes.length, RECOVERY_CODE_COUNT)
  assert.equal(new Set(codes).size, RECOVERY_CODE_COUNT)
})

test('normalisation accepts the code as a person would retype it', () => {
  assert.equal(normalizeRecoveryCode('abcde-23456'), 'ABCDE23456')
  assert.equal(normalizeRecoveryCode('ABCDE23456'), 'ABCDE23456')
  assert.equal(normalizeRecoveryCode(' abcde 23456 '), 'ABCDE23456')
  assert.equal(normalizeRecoveryCode('abcde–23456'), 'ABCDE23456')
  // Ten characters after normalising is what the verifier requires.
  assert.equal(normalizeRecoveryCode(generateRecoveryCode()).length, 10)
})

test('a batch id is unique per generation so a regeneration can invalidate the old set', () => {
  const ids = new Set(Array.from({ length: 100 }, () => generateBatchId()))
  assert.equal(ids.size, 100)
  assert.match(generateBatchId(), /^[0-9a-f]{24}$/)
})

test('constant-time equality still answers correctly, including on length mismatch', () => {
  assert.equal(constantTimeEqual('abc', 'abc'), true)
  assert.equal(constantTimeEqual('abc', 'abd'), false)
  assert.equal(constantTimeEqual('abc', 'abcd'), false, 'must not throw on unequal lengths')
  assert.equal(constantTimeEqual('', ''), true)
})

// ── Self password change ─────────────────────────────────────────────────────

test('the password change resolves its target from the session, never from the body', () => {
  const src = read('server/api/admin/profile/password.put.ts')
  assert.match(src, /const admin = event\.context\.adminUser/)
  // Every write and read is keyed on admin.id; a userId in the body would have to
  // appear here to have any effect.
  assert.ok(!/body\?\.(userId|id)\b/.test(src), 'the body must not name an account')
  assert.match(src, /eq\(users\.id, admin\.id\)/)
})

test('the password change requires the current password and the project policy', () => {
  const src = read('server/api/admin/profile/password.put.ts')
  assert.match(src, /verifyPassword\(currentPassword, row\.passwordHash\)/)
  assert.match(src, /statusCode: 401, statusMessage: 'Mật khẩu hiện tại không đúng\.'/)
  assert.match(src, /passwordRejectionMessage\(newPassword, \{ username: row\.username \}\)/)
  // Rotating to the same value must not count as a rotation.
  assert.match(src, /verifyPassword\(newPassword, row\.passwordHash\)/)
  assert.match(src, /Mật khẩu mới phải khác mật khẩu hiện tại/)
})

test('a successful password change revokes other sessions but keeps the caller in', () => {
  const src = read('server/api/admin/profile/password.put.ts')
  assert.match(src, /tokenVersion: sql`\$\{users\.tokenVersion\} \+ 1`/)
  // Without re-issuing, the caller's own cookie is the first casualty of the bump.
  assert.match(src, /setSessionCookie\(event, \{/)
  assert.match(src, /tokenVersion: fresh\?\.tokenVersion \?\? 0/)
})

test('failed current-password attempts are rate limited through the shared store', () => {
  const src = read('server/api/admin/profile/password.put.ts')
  assert.match(src, /rate-limit-store/)
  assert.match(src, /RULE: RateLimitRule = \{ limit: 5, windowSeconds: 15 \* 60 \}/)
  assert.match(src, /recordRateLimitHit\(bucket, RULE, deps\)/)
  assert.match(src, /statusCode: 429/)
  // Cleared on success so a legitimate user is not punished for earlier typos.
  assert.match(src, /clearRateLimit\(bucket, deps\)/)
})

test('the password change logs the event without any password material', () => {
  const src = read('server/api/admin/profile/password.put.ts')
  assert.match(src, /resource: 'profile_password'/)
  assert.match(src, /SECURITY_EVENTS\.passwordChanged/)
  for (const leak of ['currentPassword,', 'newPassword,', 'passwordHash,']) {
    assert.ok(!src.includes(`${leak} ip`), `log payload must not carry ${leak}`)
  }
  assert.ok(!/logInfo\(\{[^}]*(newPassword|passwordHash)/s.test(src), 'no secret in the log line')
})

// ── Enrollment ───────────────────────────────────────────────────────────────

test('enrollment writes a pending row that the login challenge cannot satisfy', () => {
  const src = read('server/api/admin/profile/mfa/enroll.post.ts')
  assert.match(src, /state: 'pending' as const/)
  // usableFactorTypes is what the challenge reads, and it only counts 'active'.
  const factors = read('server/utils/mfa/factors.ts')
  assert.match(factors, /if \(row\.state !== 'active'\) continue/)
})

test('enrollment re-authenticates and refuses to re-enroll an active factor', () => {
  const src = read('server/api/admin/profile/mfa/enroll.post.ts')
  assert.match(src, /requireCurrentPassword\(event, admin\.id, String\(body\?\.currentPassword \|\| ''\)\)/)
  assert.match(src, /existing\?\.state === 'active'/)
  assert.match(src, /statusCode: 409/)
  assert.match(src, /FACTOR_TYPES\.includes\(factorType\)/, 'the factor type is allowlisted')
})

test('the TOTP secret is sealed at rest and returned exactly once', () => {
  const src = read('server/api/admin/profile/mfa/enroll.post.ts')
  assert.match(src, /const sealed = sealTotpSecret\(secret\)/)
  assert.match(src, /secretCiphertext: sealed\.ciphertext/)
  // No plaintext column is written.
  assert.ok(!/secret:\s*secret,\s*$/m.test(src) || /return \{[\s\S]*secret,/.test(src))
  // The status endpoint is the one every later read goes through.
  const status = read('server/api/admin/profile/mfa/index.get.ts')
  assert.ok(!status.includes('secretCiphertext:'), 'status must not echo the envelope')
  assert.ok(!status.includes('unsealTotpSecret'), 'status has no reason to open the envelope')
  assert.ok(!/\bsecret\b\s*[,:]/.test(status.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')), 'no secret key in the status payload')
})

test('a lapsed pending enrollment cannot be confirmed', () => {
  const src = read('server/api/admin/profile/mfa/confirm.post.ts')
  assert.match(src, /isExpired\(/)
  assert.match(src, /pendingExpiresAt/)
})

test('the email factor refuses to enable when SMTP is unconfigured, and ignores a body address', () => {
  const src = read('server/api/admin/profile/mfa/enroll.post.ts')
  assert.match(src, /if \(!\(await isConfigured\(\)\)\)/)
  assert.match(src, /Chưa cấu hình SMTP/)
  // The stored address is the only one used.
  assert.match(src, /email: admin\.email/)
  assert.ok(!/body\?\.email/.test(src), 'an address from the request must never be honoured')
  // A send failure leaves nothing half-enabled.
  assert.match(src, /delete\(userMfaFactors\)\.where\(eq\(userMfaFactors\.id, factorId!\)\)/)
})

test('the emailed destination is masked in the response', () => {
  const src = read('server/api/admin/profile/mfa/enroll.post.ts')
  assert.match(src, /sentTo: maskEmail\(admin\.email\)/)
  assert.match(src, /return `\$\{local\.slice\(0, 1\)\}\*\*\*@\$\{domain\}`/)
})

test('the second-tier password is policy-checked, distinct from the login one, and hashed', () => {
  const src = read('server/api/admin/profile/mfa/enroll.post.ts')
  assert.match(src, /passwordRejectionMessage\(secondPassword, \{ username: account\.username \}\)/)
  assert.match(src, /verifyPassword\(secondPassword, account\.passwordHash\)/)
  assert.match(src, /Mật khẩu cấp 2 phải khác mật khẩu đăng nhập/)
  assert.match(src, /passwordHash: await hashPassword\(secondPassword\)/)
})

// ── Lifecycle ────────────────────────────────────────────────────────────────

test('disabling a factor deletes its stored material rather than flagging it', () => {
  const factors = read('server/utils/mfa/factors.ts')
  assert.match(factors, /export async function deleteFactor[\s\S]*?\.delete\(userMfaFactors\)/)
  // A state flag left behind would keep the sealed secret on disk indefinitely.
  assert.ok(!/state: 'disabled'/.test(read('server/api/admin/profile/mfa/disable.post.ts')))
  assert.match(read('server/api/admin/profile/mfa/disable.post.ts'), /deleteFactor\(/)
  assert.match(factors, /export async function pruneRecoveryCodesIfNoFactors[\s\S]*?deleteAllRecoveryCodes/)
})

/** Enable, disable, and regeneration mint new authentication material, so each
 *  invalidates sessions established under the old state. Turning codes off only
 *  removes material and is deliberately not in this list. */
test('every lifecycle action that mints material bumps the session generation', () => {
  for (const file of [
    'server/api/admin/profile/mfa/confirm.post.ts',
    'server/api/admin/profile/mfa/disable.post.ts',
    'server/api/admin/profile/mfa/recovery-codes.post.ts',
  ]) {
    assert.match(read(file), /revokeSessions\(admin\.id\)/, `${file} must revoke sessions`)
    assert.match(read(file), /setSessionCookie\(event, \{/, `${file} must keep the caller signed in`)
  }
  assert.match(
    read('server/utils/mfa/factors.ts'),
    /set\(\{ tokenVersion: sql`\$\{users\.tokenVersion\} \+ 1` \}\)/,
  )
})

// ── Recovery codes at the endpoint level ─────────────────────────────────────

test('recovery codes are only issued to an account that already has a factor', () => {
  const src = read('server/api/admin/profile/mfa/recovery-codes.post.ts')
  assert.match(src, /if \(!\(await hasAnyActiveFactor\(admin\.id\)\)\)/)
  assert.match(src, /Hãy bật ít nhất một phương thức xác thực hai bước/)
})

test('a regeneration deletes the previous batch outright', () => {
  const src = read('server/api/admin/profile/mfa/recovery-codes.post.ts')
  assert.match(src, /await deleteAllRecoveryCodes\(admin\.id\)/)
  assert.match(src, /codeHash: await hashOneTimeCode\(normalizeRecoveryCode\(code\)\)/)
  // Only the count reaches the audit trail — never the codes themselves.
  assert.match(src, /meta: \{ generated: codes\.length, ip \}/)
  assert.ok(!/meta: \{[^}]*\bcodes\b(?!\.length)/.test(src), 'the codes must never enter a log row')
  assert.ok(!/logInfo\(\{[^}]*\bcodes\b(?!\.length)/.test(src), 'the codes must never enter a log line')
})

test('redemption spends a code once, guarded against a concurrent second spend', () => {
  const factors = read('server/utils/mfa/factors.ts')
  assert.match(factors, /isNull\(userRecoveryCodes\.usedAt\)/)
  assert.match(
    factors,
    /set\(\{ usedAt: new Date\(\) \}\)\s*\.where\(and\(eq\(userRecoveryCodes\.id, row\.id\), isNull\(userRecoveryCodes\.usedAt\)\)\)/,
  )
})

// ── Login challenge ──────────────────────────────────────────────────────────

test('the challenge response names methods only and sets no session cookie', () => {
  const src = read('server/api/admin/auth/login.post.ts')
  assert.match(src, /setChallengeCookie\(event/)
  assert.match(src, /mfaRequired: true/)
  // The only cookie set on the challenge branch is the challenge one.
  const branch = src.slice(src.indexOf('setChallengeCookie'), src.indexOf('setChallengeCookie') + 600)
  assert.ok(!branch.includes('setSessionCookie'), 'the challenge branch must not issue a session')
  assert.ok(!/methods:[^\n]*secret/i.test(src))
})

test('one satisfied factor is enough when several are active', () => {
  const src = read('server/api/admin/auth/mfa/verify.post.ts')
  // A single attempt is evaluated and, on success, the login completes.
  assert.match(src, /const attempt = method === 'totp' \? await attemptTotp/)
  assert.match(src, /return completeLogin\(event, user, \{ ip, method: attempt\.method \}\)/)
  assert.match(src, /!usable\.includes\(method\)/, 'a method the account has not enabled is refused')
})

test('the challenge ticket is spent: cleared on success and on every terminal failure', () => {
  const src = read('server/api/admin/auth/mfa/verify.post.ts')
  const clears = src.match(/clearChallengeCookie\(event\)/g) ?? []
  assert.ok(clears.length >= 5, `expected the ticket cleared on each terminal path, saw ${clears.length}`)
  // Pinned to the generation at password time, so anything that revoked sessions
  // in between kills the ticket too.
  assert.match(src, /\(user\.tokenVersion \?\? 0\) !== challenge\.tokenVersion/)
})

test('verification is bounded per account, not merely per ticket', () => {
  const src = read('server/api/admin/auth/mfa/verify.post.ts')
  assert.match(src, /ACCOUNT_RULE: RateLimitRule = \{ limit: 10, windowSeconds: 15 \* 60 \}/)
  assert.match(src, /accountBucket = `mfa:verify:user:\$\{challenge\.userId\}`/)
  assert.match(src, /SECURITY_EVENTS\.mfaChallengeLocked/)
  assert.match(src, /SECURITY_EVENTS\.mfaChallengeFailed/)
  assert.match(src, /clearRateLimit\(accountBucket, deps\)/, 'a success clears the counter')
})

test('an undecryptable TOTP secret degrades to the account’s other factors', () => {
  const factors = read('server/utils/mfa/factors.ts')
  assert.match(factors, /if \(!opened\.ok\) \{[\s\S]*?logError\(\{[\s\S]*?mfa\.totp_secret_unreadable/)
  assert.match(factors, /JWT_SECRET đã thay đổi/)
  assert.match(factors, /continue/, 'the unusable factor is skipped, not thrown on')
})

test('send-code during a challenge needs a live ticket and its own limit', () => {
  const src = read('server/api/admin/auth/mfa/send-code.post.ts')
  assert.match(src, /CHALLENGE_COOKIE/)
  assert.match(src, /verifyMfaChallenge/)
  assert.match(src, /statusCode: 401/)
  assert.match(src, /rate-limit-store/)
  assert.match(src, /issueEmailCode/)
})

test('the MFA security events are declared and used', () => {
  const logger = read('server/utils/logger.ts')
  for (const key of ['mfaChallengeFailed', 'mfaChallengeLocked', 'mfaRecoveryCodeUsed', 'mfaFactorsCleared']) {
    assert.match(logger, new RegExp(`${key}:`), `${key} must be a named security event`)
  }
})

// ── Break-glass ──────────────────────────────────────────────────────────────

test('break-glass is SuperAdmin-only, not merely users.update', () => {
  const src = read('server/api/admin/users/[id]/mfa.delete.ts')
  assert.match(src, /admin\.isSuperAdmin !== true/)
  assert.match(src, /statusCode: 403/)
  // An editor holding users.update must not be able to strip a colleague's MFA.
  assert.ok(!src.includes("checkPermission"), 'must not fall back to a resource grant')
  assert.ok(!src.includes("'users'"), 'must not be gated by the users resource')
})

test('break-glass clears both factors and codes, revokes the target, and logs both sides', () => {
  const src = read('server/api/admin/users/[id]/mfa.delete.ts')
  assert.match(src, /delete\(userMfaFactors\)\.where\(eq\(userMfaFactors\.userId, id\)\)/)
  assert.match(src, /delete\(userRecoveryCodes\)\.where\(eq\(userRecoveryCodes\.userId, id\)\)/)
  /**
   * Sessions are revoked by bumping `tokenVersion`, asserted on the effect
   * rather than on a call to `revokeSessions()`.
   *
   * The helper opens its own `getDb()` handle, so it cannot join this endpoint's
   * transaction — and the four writes here have to commit together, or a
   * break-glass override can leave factors cleared with sessions still live, or
   * (worse) leave no audit trail for an override that stood. The one statement
   * is therefore inlined on `tx`. What matters is that the target's live
   * sessions still die, so that is what this checks.
   */
  assert.match(src, /tokenVersion: sql`\$\{users\.tokenVersion\} \+ 1`/,
    "the target's live sessions are no longer revoked")
  assert.match(src, /db\.transaction\(/,
    'the four writes are no longer atomic — a partial break-glass is the worst outcome here')
  // Two rows so the act is visible from either account's history.
  assert.match(src, /userId: admin\.id,\s*action: 'delete',\s*resource: 'user_mfa'/)
  assert.match(src, /userId: id,\s*action: 'delete',\s*resource: 'user_mfa'/)
  assert.match(src, /SECURITY_EVENTS\.mfaFactorsCleared/)
  assert.match(src, /statusCode: 404/, 'a missing target is a 404, not a silent success')
})

// ── Middleware stage rejection ───────────────────────────────────────────────

test('a challenge ticket cannot be spent as a session on any admin route', () => {
  const middleware = read('server/middleware/admin-auth.ts')
  // One gate covering the whole /api/admin/** surface, rather than per-route checks.
  assert.match(middleware, /if \(!url\.startsWith\('\/api\/admin\/'\)\) return/)
  assert.match(middleware, /if \(!isSessionStage\(payload\)\)/)
  assert.match(middleware, /statusCode: 401/)
  assert.match(middleware, /SECURITY_EVENTS\.mfaChallengeFailed/)
  // Only the two endpoints that sit between "password accepted" and "session
  // issued" are exempt, and they authenticate on the challenge cookie themselves.
  assert.match(middleware, /url === '\/api\/admin\/auth\/mfa\/verify' \|\| url === '\/api\/admin\/auth\/mfa\/send-code'/)
  const auth = read('server/utils/auth.ts')
  assert.match(auth, /!payload\?\.stage \|\| payload\.stage === 'session'/, 'an absent stage reads as a session')
})

test('the profile endpoints are ungated by RBAC because they are session-scoped', () => {
  for (const file of [
    'server/api/admin/profile/password.put.ts',
    'server/api/admin/profile/mfa/index.get.ts',
    'server/api/admin/profile/mfa/enroll.post.ts',
    'server/api/admin/profile/mfa/confirm.post.ts',
    'server/api/admin/profile/mfa/disable.post.ts',
    'server/api/admin/profile/mfa/recovery-codes.post.ts',
    'server/api/admin/profile/mfa/recovery-codes.delete.ts',
  ]) {
    const src = read(file)
    assert.ok(!src.includes('checkPermission'), `${file} must not require a resource grant`)
    // The session is the only source of identity, so there is nothing to gate.
    assert.match(src, /event\.context\.adminUser/, `${file} must read the session`)
    assert.match(src, /statusCode: 401, statusMessage: 'Unauthorized'/, `${file} must refuse an absent session`)
  }
})

// ── History bounds ───────────────────────────────────────────────────────────

test('history reads the caller’s own rows by default', () => {
  const src = read('server/api/admin/profile/history.get.ts')
  assert.match(src, /eq\(activityLogs\.userId, targetId\)/)
  // The default is the session's own id; a body/query id only narrows from there.
  assert.match(src, /let targetId = admin\.id/)
})

test('a cross-user history read is SuperAdmin-only and logs itself', () => {
  const src = read('server/api/admin/profile/history.get.ts')
  assert.match(src, /admin\.isSuperAdmin !== true/)
  assert.match(src, /statusCode: 403/)
  assert.match(src, /resource: 'user_history'/)
  assert.match(src, /insert\(activityLogs\)/)
})

test('history validates its bounds instead of scanning unbounded', () => {
  const src = read('server/api/admin/profile/history.get.ts')
  assert.match(src, /MAX_PAGE_SIZE = 100/)
  assert.match(src, /DEFAULT_PAGE_SIZE = 20/)
  assert.match(src, /statusCode: 400/)
  assert.match(src, /không phải là ngày hợp lệ/)
  // Ordering is tie-broken so pagination cannot repeat or skip a row.
  assert.match(src, /orderBy\(desc\(activityLogs\.createdAt\), desc\(activityLogs\.id\)\)/)
})

test('history surfaces an allowlist of meta fields, not the whole blob', () => {
  const src = read('server/api/admin/profile/history.get.ts')
  assert.match(src, /readMeta\(/)
  assert.match(src, /'ip'|ip:/)
  assert.ok(!/meta: row\.meta\b/.test(src), 'the raw meta object must not be returned')
})
