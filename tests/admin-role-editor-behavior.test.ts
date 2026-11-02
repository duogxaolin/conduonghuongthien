import assert from 'node:assert/strict'
import test, { after, beforeEach, mock } from 'node:test'

/**
 * The role editor's server side (`/admin/users/roles`), behind the real `admin-auth`
 * middleware (role + permissions read from the database), with Drizzle's MySQL SQL run on
 * SQLite (`_sqlite-mysql-db.ts`, real transaction) — the shape of
 * tests/admin-role-delete-behavior.test.ts.
 *
 *   - `POST /api/admin/roles` ("Thêm vai trò", now reachable from the page): needs
 *     `roles.create`; a name already taken is the server's 400 sentence, an over-long name or
 *     description is refused before any write, and any other failure is a 500 that carries no
 *     SQL — before, all three were an unhandled 500 whose message was Drizzle's
 *     "Failed query: <SQL> params: …".
 *   - `GET /api/admin/roles`: each role says how many accounts hold it (`userCount`), the
 *     same rows `[id].delete.ts` refuses on — the page greys out "Xóa vai trò" from it.
 *   - `PUT /api/admin/roles/:id`: the retired cells the page no longer shows ("Trang chủ" =
 *     `home_sections`, "Kiểm thử" = `canTest`) come back in the payload exactly as stored,
 *     are stored unchanged, and do not count against a delegated manager who cannot hold
 *     them any more (`isRetiredPermission`, shared/permissions.ts).
 */

process.env.JWT_SECRET = 'admin-role-editor-behavior-test-secret-0123456789'
delete process.env.MFA_ENFORCEMENT

const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const { roles, permissions, users, settings, userMfaFactors, activityLogs } = await import('../server/db/schema')
const harness = createSqliteMysqlDb([roles, permissions, users, settings, userMfaFactors, activityLogs])

const logged: Array<Record<string, unknown>> = []
mock.module('../server/utils/logger', {
  namedExports: {
    log: () => {},
    logInfo: () => {},
    logWarn: () => {},
    logError: (entry: Record<string, unknown>) => { logged.push(entry) },
    SECURITY_EVENTS: new Proxy({}, { get: (_target, key) => `event.${String(key)}` }),
  },
})
mock.module('../server/utils/db', { namedExports: { getDb: () => harness.db, getPool: () => null } })

const { installH3Globals, startHandlerServer } = await import('./_h3-handler-server')
installH3Globals()
const adminAuth = (await import('../server/middleware/admin-auth')).default
const listRoles = (await import('../server/api/admin/roles/index.get')).default
const createRole = (await import('../server/api/admin/roles/index.post')).default
const updateRole = (await import('../server/api/admin/roles/[id].put')).default
const { signToken } = await import('../server/utils/auth')
const policy = await import('../server/utils/mfa/policy')
const { rolePermissionMatrix } = await import('../shared/permissions')

const server = await startHandlerServer([
  { method: 'get', path: '/api/admin/roles', handler: listRoles },
  { method: 'post', path: '/api/admin/roles', handler: createRole },
  { method: 'put', path: '/api/admin/roles/:id', handler: updateRole },
], [adminAuth])
after(() => server.close())

type Account = { id: number, username: string, roleId: number, roleName: string }
const SUPERADMIN: Account = { id: 1, username: 'admin', roleId: 1, roleName: 'Quản trị hệ thống' }
const EDITOR_ROLE = 2
/** Full rights on roles + the editor's own news rights; no `home_sections`, no `canTest` — none can be granted now. */
const ROLE_MANAGER: Account = { id: 5, username: 'rolemanager', roleId: 3, roleName: 'Quản lý vai trò' }
const ROLE_READER: Account = { id: 6, username: 'roleviewer', roleId: 4, roleName: 'Xem vai trò' }
const UNUSED_ROLE = 6

const cookieFor = (account: Account) =>
  `cdkt_admin=${signToken({ userId: account.id, username: account.username, roleId: account.roleId, roleName: account.roleName, tokenVersion: 0 })}`
const call = (method: string, path: string, account: Account, body?: unknown) =>
  server.request(method, path, { cookie: cookieFor(account), body })

const roleNames = () => harness.rows(roles).map(row => String(row.name)).sort()
const rowsOf = (roleId: number) => harness.rows(permissions).filter(row => row.roleId === roleId)
const rowOf = (roleId: number, resource: string) => rowsOf(roleId).find(row => row.resource === resource)

beforeEach(async () => {
  harness.reset()
  logged.length = 0
  policy.clearMfaPolicyCache()
  policy.clearMfaFactorCache()
  await harness.db.insert(roles).values([
    { id: 1, name: SUPERADMIN.roleName, isSystem: true },
    { id: EDITOR_ROLE, name: 'editor', isSystem: false },
    { id: 3, name: ROLE_MANAGER.roleName, isSystem: false },
    { id: 4, name: ROLE_READER.roleName, isSystem: false },
    { id: UNUSED_ROLE, name: 'Vai trò bỏ không', isSystem: false },
  ])
  await harness.db.insert(permissions).values([
    // The seeded editor (server/db/seed.ts): news create/read/update and `home_sections:read`;
    // `canTest` on news stands for a value stored back when the column was still shown.
    { roleId: EDITOR_ROLE, resource: 'news', canCreate: true, canRead: true, canUpdate: true, canTest: true },
    { roleId: EDITOR_ROLE, resource: 'home_sections', canRead: true },
    { roleId: 3, resource: 'roles', canCreate: true, canRead: true, canUpdate: true, canDelete: true },
    { roleId: 3, resource: 'news', canCreate: true, canRead: true, canUpdate: true },
    { roleId: 4, resource: 'roles', canRead: true },
  ])
  await harness.db.insert(users).values([
    SUPERADMIN, ROLE_MANAGER, ROLE_READER,
    { id: 8, username: 'bientap1', roleId: EDITOR_ROLE, roleName: 'editor' },
    { id: 9, username: 'bientap2', roleId: EDITOR_ROLE, roleName: 'editor' },
  ].map(account => ({
    id: account.id, username: account.username, email: `${account.username}@example.vn`, passwordHash: 'x', roleId: account.roleId,
  })))
  // A locked account still holds its role, and still blocks deleting it (`[id].delete.ts`).
  harness.sqlite.prepare('UPDATE users SET is_active = 0 WHERE id = 9').run()
})

// ─── POST /api/admin/roles ───────────────────────────────────────────────────

test('create: roles.create adds the role — no permission rows — and audits it against the actor', async () => {
  const response = await call('POST', '/api/admin/roles', ROLE_MANAGER, { name: '  Cộng tác viên  ', description: ' Viết tin ' })
  assert.equal(response.status, 200)
  const created = harness.rows(roles).find(row => row.name === 'Cộng tác viên')!
  assert.deepEqual([response.body.ok, response.body.id], [true, created.id])
  assert.equal(created.description, 'Viết tin')
  assert.equal(Boolean(created.isSystem), false)
  assert.deepEqual(rowsOf(Number(created.id)), [])
  const audit = harness.rows(activityLogs)
  assert.deepEqual(audit.map(row => [row.userId, row.action, row.resource, row.resourceId]), [[ROLE_MANAGER.id, 'create', 'roles', created.id]])
})

test('create: roles.read alone is a 403 and writes nothing', async () => {
  const before = roleNames()
  assert.equal((await call('POST', '/api/admin/roles', ROLE_READER, { name: 'Vai trò mới' })).status, 403)
  assert.deepEqual(roleNames(), before)
  assert.equal(harness.rows(activityLogs).length, 0)
})

test('create: a name already taken is the server\'s 400 sentence — not a 500', async () => {
  // SQLite has no unique index here (`_sqlite-mysql-db.ts`): the error MySQL raises on
  // `roles.name UNIQUE` (utf8mb4_unicode_ci: case- AND accent-insensitive, so "Ëdîtor" collides
  // with "editor") is injected, wrapped by Drizzle as on MySQL. The sentence says how names
  // compare — an officer looking for an exact twin of "Ëdîtor" would find none (verifier W4).
  harness.failNext(/^insert into `roles`/, { errno: 1062, code: 'ER_DUP_ENTRY' })
  const response = await call('POST', '/api/admin/roles', ROLE_MANAGER, { name: 'Ëdîtor' })
  assert.deepEqual([response.status, response.body.statusMessage],
    [400, 'Tên vai trò trùng với vai trò đã có (không phân biệt hoa/thường và dấu). Vui lòng chọn tên khác.'])
  assert.equal(harness.rows(activityLogs).length, 0)
  assert.deepEqual(logged, [], 'a refused name is not a system failure')
})

test('create: the minimum length counts code points — one emoji is one character (verifier S2)', async () => {
  const before = roleNames()
  for (const name of ['😀', ' 😀 ', 'a']) {
    const response = await call('POST', '/api/admin/roles', ROLE_MANAGER, { name })
    assert.deepEqual([response.status, response.body.statusMessage], [400, 'Tên vai trò phải từ 2 ký tự trở lên.'], JSON.stringify(name))
  }
  assert.deepEqual(roleNames(), before)
  assert.equal((await call('POST', '/api/admin/roles', ROLE_MANAGER, { name: '😀😀' })).status, 200)
})

test('create: a name or description that is not a string is a 400 — never "[object Object]" (verifier S3)', async () => {
  const before = roleNames()
  for (const name of [{}, ['Biên tập'], 12345, true]) {
    const response = await call('POST', '/api/admin/roles', ROLE_MANAGER, { name })
    assert.deepEqual([response.status, response.body.statusMessage], [400, 'Tên vai trò phải là chuỗi ký tự.'], JSON.stringify(name))
  }
  for (const description of [{}, ['Viết tin'], 5, false]) {
    const response = await call('POST', '/api/admin/roles', ROLE_MANAGER, { name: 'Hợp lệ', description })
    assert.deepEqual([response.status, response.body.statusMessage], [400, 'Mô tả vai trò phải là chuỗi ký tự.'], JSON.stringify(description))
  }
  assert.deepEqual(roleNames(), before)
  assert.equal(harness.rows(activityLogs).length, 0)
  // Absent and null still read as empty: a missing name is the length sentence, a missing description is none.
  const missing = await call('POST', '/api/admin/roles', ROLE_MANAGER, { description: 'x' })
  assert.deepEqual([missing.status, missing.body.statusMessage], [400, 'Tên vai trò phải từ 2 ký tự trở lên.'])
  const noDescription = await call('POST', '/api/admin/roles', ROLE_MANAGER, { name: 'Không mô tả', description: null })
  assert.equal(noDescription.status, 200)
  assert.equal(harness.rows(roles).find(row => row.name === 'Không mô tả')?.description, null)
})

test('create: a name over 64 characters or a description over 255 is refused before any write', async () => {
  const before = roleNames()
  const tooLong = await call('POST', '/api/admin/roles', ROLE_MANAGER, { name: 'đ'.repeat(65) })
  assert.deepEqual([tooLong.status, tooLong.body.statusMessage], [400, 'Tên vai trò tối đa 64 ký tự.'])
  const longText = await call('POST', '/api/admin/roles', ROLE_MANAGER, { name: 'Hợp lệ', description: 'ệ'.repeat(256) })
  assert.deepEqual([longText.status, longText.body.statusMessage], [400, 'Mô tả vai trò tối đa 255 ký tự.'])
  assert.deepEqual(roleNames(), before)
  // The limits are code points, as `VARCHAR(n)` counts them in utf8mb4 — not UTF-16 units.
  const atLimit = await call('POST', '/api/admin/roles', ROLE_MANAGER, { name: '😀'.repeat(64), description: '😀'.repeat(255) })
  assert.equal(atLimit.status, 200)
})

test('create: any other failure is a 500 "Lỗi hệ thống" that names no SQL; the driver\'s message goes to the log', async () => {
  const before = roleNames()
  harness.failNext(/^insert into `activity_logs`/, { errno: 1452, code: 'ER_NO_REFERENCED_ROW_2' })
  const response = await call('POST', '/api/admin/roles', ROLE_MANAGER, { name: 'Vai trò lỗi' })
  assert.deepEqual([response.status, response.body.statusMessage], [500, 'Lỗi hệ thống'])
  assert.ok(!JSON.stringify(response.body).includes('insert into'), JSON.stringify(response.body))
  assert.deepEqual(roleNames(), before, 'the role and its audit row commit together, or neither')
  assert.deepEqual(logged.map(entry => entry.event), ['admin_roles.create_failed'])
})

// ─── GET /api/admin/roles ────────────────────────────────────────────────────

test('list: each role carries how many accounts hold it — locked accounts included', async () => {
  const response = await call('GET', '/api/admin/roles', ROLE_READER)
  assert.equal(response.status, 200)
  const counts = Object.fromEntries((response.body.roles as Array<{ id: number, userCount: number }>).map(role => [role.id, role.userCount]))
  assert.deepEqual(counts, { 1: 1, [EDITOR_ROLE]: 2, 3: 1, 4: 1, [UNUSED_ROLE]: 0 })
})

// ─── PUT /api/admin/roles/:id — the retired cells ────────────────────────────

/** What the page sends: every catalog cell, as stored, with the visible edits applied. */
function editorPayload(edit: (matrix: ReturnType<typeof rolePermissionMatrix>) => void) {
  const matrix = rolePermissionMatrix(rowsOf(EDITOR_ROLE) as Parameters<typeof rolePermissionMatrix>[0])
  edit(matrix)
  return Object.entries(matrix).map(([resource, flags]) => ({ resource, ...flags }))
}

test('save: a delegated manager edits the editor role; the hidden "Trang chủ" row and "Kiểm thử" flag are stored unchanged', async () => {
  const response = await call('PUT', `/api/admin/roles/${EDITOR_ROLE}`, ROLE_MANAGER, {
    permissions: editorPayload(matrix => { matrix.news!.canUpdate = false }),
  })
  assert.equal(response.status, 200, JSON.stringify(response.body))
  const news = rowOf(EDITOR_ROLE, 'news')!
  assert.deepEqual([Boolean(news.canCreate), Boolean(news.canRead), Boolean(news.canUpdate)], [true, true, false], 'the visible edit is saved')
  assert.equal(Boolean(news.canTest), true, '"Kiểm thử" (canTest) is not wiped by a save')
  assert.equal(Boolean(rowOf(EDITOR_ROLE, 'home_sections')?.canRead), true, '"Trang chủ" (home_sections) is not wiped by a save')
})

test('save: a retired cell never needs holding — but a real one still does', async () => {
  // Raising a retired cell grants nothing: no 403 for it.
  const retired = await call('PUT', `/api/admin/roles/${EDITOR_ROLE}`, ROLE_MANAGER, {
    permissions: editorPayload(matrix => { matrix.home_sections!.canUpdate = true; matrix.news!.canTest = true }),
  })
  assert.equal(retired.status, 200, JSON.stringify(retired.body))
  // A real right the manager lacks is still refused, and nothing is written.
  const stored = JSON.stringify(rowsOf(EDITOR_ROLE))
  for (const edit of [
    (matrix: ReturnType<typeof rolePermissionMatrix>) => { matrix.news!.canPublish = true },
    (matrix: ReturnType<typeof rolePermissionMatrix>) => { matrix.users!.canRead = true },
  ]) {
    const refused = await call('PUT', `/api/admin/roles/${EDITOR_ROLE}`, ROLE_MANAGER, { permissions: editorPayload(edit) })
    assert.equal(refused.status, 403)
    assert.equal(JSON.stringify(rowsOf(EDITOR_ROLE)), stored)
  }
})

test('save: a role holding a REAL right the manager lacks is still not theirs to rewrite', async () => {
  harness.sqlite.prepare("UPDATE permissions SET can_publish = 1 WHERE role_id = 2 AND resource = 'news'").run()
  const stored = JSON.stringify(rowsOf(EDITOR_ROLE))
  const response = await call('PUT', `/api/admin/roles/${EDITOR_ROLE}`, ROLE_MANAGER, {
    permissions: editorPayload(matrix => { matrix.news!.canPublish = false }),
  })
  assert.equal(response.status, 403)
  assert.equal(JSON.stringify(rowsOf(EDITOR_ROLE)), stored)
})
