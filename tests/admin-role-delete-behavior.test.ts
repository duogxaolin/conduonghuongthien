import assert from 'node:assert/strict'
import test, { after, beforeEach, mock } from 'node:test'

/**
 * `DELETE /api/admin/roles/:id` (server/api/admin/roles/[id].delete.ts) — remove a
 * permission role.
 *
 * A role decides what everybody holding it can do, so the invariants are:
 *   - it takes `roles.delete` — `roles.read` + `roles.update` is a 403 that deletes
 *     nothing;
 *   - a system role (the SuperAdmin's) is never deleted, not even by a SuperAdmin;
 *   - a role still assigned to an account is never deleted — including the one the
 *     caller is acting under; the accounts would be left without a role;
 *   - only the named role goes, and the row and its audit line commit together: if
 *     the audit cannot be written, the role is still there.
 *
 * Real h3 app: the real `admin-auth` middleware (role + permissions from the
 * database) in front of the real handler. Drizzle's SQL runs on SQLite
 * (`_sqlite-mysql-db.ts`, real transaction). The harness creates no foreign keys,
 * so what MySQL's `ON DELETE CASCADE` does to the role's `permissions` rows is not
 * shown here.
 */

process.env.JWT_SECRET = 'admin-role-delete-behavior-test-secret-0123456789'
delete process.env.MFA_ENFORCEMENT

const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const { roles, permissions, users, settings, userMfaFactors, activityLogs } = await import('../server/db/schema')
const harness = createSqliteMysqlDb([roles, permissions, users, settings, userMfaFactors, activityLogs])

mock.module('../server/utils/logger', {
  namedExports: {
    log: () => {},
    logInfo: () => {},
    logWarn: () => {},
    logError: () => {},
    SECURITY_EVENTS: new Proxy({}, { get: (_target, key) => `event.${String(key)}` }),
  },
})
mock.module('../server/utils/db', { namedExports: { getDb: () => harness.db, getPool: () => null } })

const { installH3Globals, startHandlerServer } = await import('./_h3-handler-server')
installH3Globals()
const adminAuth = (await import('../server/middleware/admin-auth')).default
const deleteRole = (await import('../server/api/admin/roles/[id].delete')).default
const { signToken } = await import('../server/utils/auth')
const policy = await import('../server/utils/mfa/policy')

const server = await startHandlerServer([{ method: 'delete', path: '/api/admin/roles/:id', handler: deleteRole }], [adminAuth])
after(() => server.close())

type Account = { id: number, username: string, roleId: number, roleName: string }
const SUPERADMIN: Account = { id: 1, username: 'admin', roleId: 1, roleName: 'Quản trị hệ thống' }
const ROLE_MANAGER: Account = { id: 5, username: 'rolemanager', roleId: 3, roleName: 'Quản lý vai trò' }
const ROLE_EDITOR: Account = { id: 6, username: 'roleeditor', roleId: 4, roleName: 'Sửa vai trò' }
const REPORTER: Account = { id: 9, username: 'reporter', roleId: 7, roleName: 'Phóng viên' }
const UNUSED_ROLE = 6

const cookieFor = (account: Account) =>
  `cdkt_admin=${signToken({ userId: account.id, username: account.username, roleId: account.roleId, roleName: account.roleName, tokenVersion: 0 })}`
const remove = (id: number | string, account = ROLE_MANAGER) =>
  server.request('DELETE', `/api/admin/roles/${id}`, { cookie: cookieFor(account) })

const roleIds = () => harness.rows(roles).map(row => row.id).sort((a, b) => Number(a) - Number(b))
const snapshot = () => ({ roles: roleIds(), audit: harness.rows(activityLogs).length })

beforeEach(async () => {
  harness.reset()
  policy.clearMfaPolicyCache()
  policy.clearMfaFactorCache()
  await harness.db.insert(roles).values([
    { id: 1, name: SUPERADMIN.roleName, isSystem: true },
    { id: 3, name: ROLE_MANAGER.roleName, isSystem: false },
    { id: 4, name: ROLE_EDITOR.roleName, isSystem: false },
    { id: UNUSED_ROLE, name: 'Vai trò bỏ không', isSystem: false },
    { id: 7, name: REPORTER.roleName, isSystem: false },
  ])
  await harness.db.insert(permissions).values([
    { roleId: 3, resource: 'roles', canRead: true, canUpdate: true, canDelete: true },
    { roleId: 4, resource: 'roles', canCreate: true, canRead: true, canUpdate: true },
    { roleId: UNUSED_ROLE, resource: 'news', canRead: true },
  ])
  await harness.db.insert(users).values([SUPERADMIN, ROLE_MANAGER, ROLE_EDITOR, REPORTER].map(account => ({
    id: account.id, username: account.username, email: `${account.username}@example.vn`, passwordHash: 'x', roleId: account.roleId,
  })))
})

test('roles.read + roles.update is not enough: 403 and nothing is deleted', async () => {
  const before = snapshot()
  assert.equal((await remove(UNUSED_ROLE, ROLE_EDITOR)).status, 403)
  assert.equal((await server.request('DELETE', `/api/admin/roles/${UNUSED_ROLE}`)).status, 401)
  assert.deepEqual(snapshot(), before)
})

test('a system role is never deleted — not by a role manager, not by the SuperAdmin', async () => {
  const before = snapshot()
  // Unassign the system role first, so the "still assigned" rule is not what stops it.
  harness.sqlite.prepare('UPDATE users SET role_id = 3 WHERE id = 1').run()
  assert.equal((await remove(1)).status, 400)
  harness.sqlite.prepare('UPDATE users SET role_id = 1 WHERE id = 1').run()
  assert.equal((await remove(1, SUPERADMIN)).status, 400)
  assert.deepEqual(snapshot(), before)
})

test('a role still assigned to an account is never deleted — the caller\'s own included', async () => {
  const before = snapshot()
  assert.equal((await remove(7)).status, 400)
  assert.equal((await remove(ROLE_MANAGER.roleId)).status, 400)
  assert.deepEqual(snapshot(), before)
})

test('an unknown or malformed id deletes nothing', async () => {
  const before = snapshot()
  assert.equal((await remove(999)).status, 404)
  assert.equal((await remove('abc')).status, 400)
  assert.equal((await remove(0)).status, 400)
  assert.deepEqual(snapshot(), before)
})

test('an unassigned role is deleted — only that one — and audited against the actor', async () => {
  const response = await remove(UNUSED_ROLE)
  assert.equal(response.status, 200)
  assert.deepEqual(roleIds(), [1, 3, 4, 7])
  const audit = harness.rows(activityLogs)
  assert.equal(audit.length, 1)
  assert.equal(audit[0]!.userId, ROLE_MANAGER.id)
  assert.equal(audit[0]!.action, 'delete')
  assert.equal(audit[0]!.resource, 'roles')
  assert.equal(audit[0]!.resourceId, UNUSED_ROLE)
})

test('if the audit row cannot be written, the role is still there', async () => {
  const before = snapshot()
  harness.failNext(/^insert into `activity_logs`/)
  assert.equal((await remove(UNUSED_ROLE)).status, 500)
  assert.deepEqual(snapshot(), before)
})
