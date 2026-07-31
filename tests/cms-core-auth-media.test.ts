import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { checkPermission } from '../server/utils/auth'

/**
 * Authentication, session revocation, uploads and the public submission form —
 * the CMS paths that carry the security fixes and previously had no coverage.
 *
 * The endpoints themselves need a live H3 event and MySQL, so the behavioural
 * assertions here target the pure permission logic, and the remainder pins the
 * security-relevant wiring of each handler so a future edit cannot quietly drop
 * a guard.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

// ─── Permission matrix ───────────────────────────────────────────────────────
const perms = [
  { resource: 'news', canCreate: true, canRead: true, canUpdate: true, canDelete: false },
  { resource: 'media', canCreate: true, canRead: true, canUpdate: false, canDelete: false },
]

test('checkPermission honours the per-action flags', () => {
  assert.equal(checkPermission(perms, 'news', 'create'), true)
  assert.equal(checkPermission(perms, 'news', 'delete'), false)
  assert.equal(checkPermission(perms, 'media', 'update'), false)
})

test('an unlisted resource is denied rather than defaulting to allowed', () => {
  assert.equal(checkPermission(perms, 'users', 'read'), false)
  assert.equal(checkPermission(perms, 'settings', 'update'), false)
  assert.equal(checkPermission([], 'news', 'read'), false)
})

test('the superadmin flag overrides the matrix, and only when true', () => {
  assert.equal(checkPermission([], 'users', 'delete', true), true)
  assert.equal(checkPermission([], 'users', 'delete', false), false)
  assert.equal(checkPermission([], 'users', 'delete', undefined as unknown as boolean), false)
})

// ─── Session revocation ──────────────────────────────────────────────────────
test('tokens carry a version that the admin middleware enforces', () => {
  const auth = read('server/utils/auth.ts')
  const middleware = read('server/middleware/admin-auth.ts')
  // Minting moved out of the login handler when the MFA challenge split the flow
  // into "password accepted" and "session issued"; the guarantee is unchanged, so
  // this now reads the single place that mints.
  const session = read('server/utils/mfa/session.ts')

  assert.match(auth, /tokenVersion\??:\s*number/)
  assert.match(session, /tokenVersion:\s*user\.tokenVersion/)
  assert.match(middleware, /tokenVersion:\s*users\.tokenVersion/)
  assert.match(middleware, /payload\.tokenVersion \?\? 0\) !== \(user\.tokenVersion \?\? 0\)/)
  assert.match(middleware, /Session revoked/)
})

test('logout and password change both invalidate existing sessions', () => {
  const logout = read('server/api/admin/auth/logout.post.ts')
  assert.match(logout, /tokenVersion:\s*sql`\$\{users\.tokenVersion\} \+ 1`/)
  assert.match(logout, /deleteCookie\(event, 'cdkt_admin'/)

  const userPut = read('server/api/admin/users/[id].put.ts')
  assert.match(userPut, /updateData\.passwordHash = await hashPassword/)
  assert.match(userPut, /updateData\.tokenVersion = sql`\$\{users\.tokenVersion\} \+ 1`/)
})

test('production refuses to run on a missing or known-default JWT secret', () => {
  const auth = read('server/utils/auth.ts')
  const guard = read('server/plugins/require-secrets.ts')
  assert.doesNotMatch(auth, /cdkt_admin_secret_change_me/)
  assert.match(auth, /JWT_SECRET is not configured/)
  for (const weak of ['cdkt_admin_secret_change_me', 'cdkt_docker_jwt_secret_987654321']) {
    assert.ok(guard.includes(weak), `boot guard does not reject the default: ${weak}`)
  }
})

// ─── Login hardening ─────────────────────────────────────────────────────────
test('login rate-limits on an address the client cannot choose', () => {
  const login = read('server/api/admin/auth/login.post.ts')
  // This used to pin `getRequestIP(event, { xForwardedFor: false })`, which is
  // unforgeable but, once nginx is in front, identical for every visitor — the
  // per-source limit became a second copy of the per-username one. getClientIp
  // reads the forwarded chain only from a proxy we listed; see client-ip.test.ts.
  assert.match(login, /getClientIp\(event\)/)
  assert.doesNotMatch(login, /const ip = getRequestHeader\(event, 'x-forwarded-for'\)/)
  // Named for the bucket, not the data structure: this assertion previously
  // pinned a `Map` variable name and broke when the counters moved to a shared
  // table, even though the lockout itself never went away.
  assert.match(login, /login:user:/, 'missing per-username lockout')
})

test('a disabled account is indistinguishable from a wrong password', () => {
  const login = read('server/api/admin/auth/login.post.ts')
  // Both branches must return the same message, or the response enumerates accounts.
  const messages = [...login.matchAll(/statusCode: 401, statusMessage: '([^']+)'/g)].map(m => m[1])
  assert.ok(messages.length >= 3, `expected several 401 branches, saw ${messages.length}`)
  assert.equal(new Set(messages).size, 1, `401 responses differ and leak account state: ${[...new Set(messages)]}`)
})

test('the session cookie is httpOnly and no longer outlives its token', () => {
  const session = read('server/utils/mfa/session.ts')
  assert.match(session, /httpOnly:\s*true/)
  assert.match(session, /sameSite:\s*'lax'/)
  assert.match(session, /maxAge:\s*SESSION_MAX_AGE/)
  assert.match(session, /SESSION_MAX_AGE = 8 \* 60 \* 60/)
})

test('the MFA challenge ticket is a separate, short-lived cookie', () => {
  const session = read('server/utils/mfa/session.ts')
  // A distinct name matters: every existing /api/admin/** route reads `cdkt_admin`,
  // so a half-authenticated ticket landing in that cookie would be spent as a session.
  assert.match(session, /CHALLENGE_COOKIE = 'cdkt_mfa'/)
  assert.match(session, /SESSION_COOKIE = 'cdkt_admin'/)
  assert.match(session, /maxAge:\s*MFA_CHALLENGE_TTL_SECONDS/)

  const auth = read('server/utils/auth.ts')
  assert.match(auth, /stage: 'mfa-challenge'/)
  // Absence of the claim must read as a session, or the deploy logs everyone out.
  assert.match(auth, /!payload\?\.stage \|\| payload\.stage === 'session'/)

  const middleware = read('server/middleware/admin-auth.ts')
  assert.match(middleware, /!isSessionStage\(payload\)/, 'middleware no longer rejects a challenge ticket')
})

// ─── Uploads ─────────────────────────────────────────────────────────────────
test('the stored extension comes from the validated MIME, not the filename', () => {
  const upload = read('server/api/admin/media/upload.post.ts')
  assert.match(upload, /EXT_BY_MIME/)
  assert.match(upload, /effectiveMime/)
  assert.doesNotMatch(upload, /const ext = path\.extname\(originalName\)/)
})

test('uploaded files are never served as inline SVG', () => {
  const route = read('server/routes/uploads/[...path].ts')
  const mimeTable = route.match(/const mimeMap[^{]*\{([\s\S]*?)\}/)?.[1] || ''
  assert.ok(mimeTable, 'mime table not found')
  assert.doesNotMatch(mimeTable, /svg/i, 'svg is mapped to a renderable content type')
  assert.match(route, /X-Content-Type-Options.*nosniff/s)
  assert.match(route, /Content-Disposition.*attachment/s)
})

test('the uploads route still refuses to escape its root', () => {
  const route = read('server/routes/uploads/[...path].ts')
  assert.match(route, /replace\(\/\\\.\\\.\/g, ''\)/, 'traversal stripping removed')
  assert.match(route, /startsWith\(uploadsRoot \+ path\.sep\)/, 'root containment check removed')
})

// ─── Public submissions ──────────────────────────────────────────────────────
test('the public form is rate-limited and cannot pick an arbitrary recipient', () => {
  const submissions = read('server/api/submissions.post.ts')
  assert.match(submissions, /submitRateLimited/)
  // Same reasoning as the login test above: behind a proxy the peer address is
  // one shared value, so the 5-per-10-minutes quota would be shared too.
  assert.match(submissions, /getClientIp\(event\)/)
  assert.match(submissions, /getConfiguredRecipients/, 'recipient allow-list removed')
  assert.match(submissions, /allowed\.has\(to\)/)
})

test('visitor-supplied text is escaped before it reaches the notification email', () => {
  const submissions = read('server/api/submissions.post.ts')
  assert.match(submissions, /escapeHtml\(a\.label\)/)
  assert.match(submissions, /escapeHtml\(a\.value\)/)
  assert.match(submissions, /escapeHtml\(formTitle/)
})

test('settings writes are allow-listed and site-wide script keys are superadmin-only', () => {
  const settings = read('server/api/admin/settings/index.put.ts')
  assert.match(settings, /ALLOWED_SETTING_KEYS/)
  assert.match(settings, /SUPERADMIN_ONLY_KEYS/)
  assert.match(settings, /tracking_custom_head/)
  assert.match(settings, /Khóa cài đặt không hợp lệ/)
})
