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
  const login = read('server/api/admin/auth/login.post.ts')

  assert.match(auth, /tokenVersion\??:\s*number/)
  assert.match(login, /tokenVersion:\s*user\.tokenVersion/)
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
test('login rate-limits on the observed peer, not a client-supplied header', () => {
  const login = read('server/api/admin/auth/login.post.ts')
  assert.match(login, /getRequestIP\(event, \{ xForwardedFor: false \}\)/)
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
  const login = read('server/api/admin/auth/login.post.ts')
  assert.match(login, /httpOnly:\s*true/)
  assert.match(login, /sameSite:\s*'lax'/)
  assert.match(login, /maxAge:\s*8 \* 60 \* 60/)
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
  assert.match(submissions, /getRequestIP\(event, \{ xForwardedFor: false \}\)/)
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
