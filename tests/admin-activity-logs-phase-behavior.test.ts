import assert from 'node:assert/strict'
import test, { after, beforeEach, mock } from 'node:test'

/**
 * `GET /api/admin/activity-logs` (server/api/admin/activity-logs/index.get.ts) surfaces
 * `meta.phase`, so `/admin/users/activity` can tell the two rows of a manual retention run
 * apart (`retention-run.post.ts`: 'started' under the lock before the first DELETE,
 * 'finished' with what each table lost). Pinned on the real handler:
 *   - an object meta with a `phase` string → that phase;
 *   - every other row → null: no `phase` key, a non-string one, a meta that is a JSON STRING
 *     (rows written before FINDING-R3-3 — the reader treats a string as "no keys", the same
 *     way it already does for ip / userAgent / mfaMethod), no meta at all;
 *   - still only the allowlisted keys: the rest of the meta (the run's scopes) and the raw
 *     column never reach the response.
 *
 * Real h3 app with the real `admin-auth` middleware; Drizzle's SQL on SQLite.
 */

process.env.JWT_SECRET = 'admin-activity-logs-phase-behavior-test-secret-0123456789'
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
const list = (await import('../server/api/admin/activity-logs/index.get')).default
const { signToken } = await import('../server/utils/auth')
const policy = await import('../server/utils/mfa/policy')

const server = await startHandlerServer([{ method: 'get', path: '/api/admin/activity-logs', handler: list }], [adminAuth])
after(() => server.close())

const AUDITOR = { id: 7, username: 'kiemtoan', roleId: 3, roleName: 'Kiểm toán' }
const cookie = `cdkt_admin=${signToken({ userId: AUDITOR.id, username: AUDITOR.username, roleId: AUDITOR.roleId, roleName: AUDITOR.roleName, tokenVersion: 0 })}`

beforeEach(async () => {
  harness.reset()
  policy.clearMfaPolicyCache()
  policy.clearMfaFactorCache()
  await harness.db.insert(roles).values({ id: 3, name: AUDITOR.roleName, isSystem: false })
  await harness.db.insert(permissions).values({ roleId: 3, resource: 'users', canRead: true })
  await harness.db.insert(users).values({ id: AUDITOR.id, username: AUDITOR.username, email: 'kiemtoan@example.vn', passwordHash: 'x', roleId: 3 })
  const at = (minute: number) => new Date(Date.UTC(2026, 9, 28, 3, minute))
  await harness.db.insert(activityLogs).values([
    { userId: AUDITOR.id, action: 'delete', resource: 'data_retention', meta: { trigger: 'manual', phase: 'started', scopes: [{ scope: 'activity_logs', days: 365 }] }, createdAt: at(1) },
    { userId: AUDITOR.id, action: 'delete', resource: 'data_retention', meta: { trigger: 'manual', phase: 'finished', status: 'success', tables: [] }, createdAt: at(2) },
    // Written as a JSON string before FINDING-R3-3: no keys are read from it.
    { userId: AUDITOR.id, action: 'delete', resource: 'data_retention', meta: '{"trigger":"manual","phase":"finished"}', createdAt: at(3) },
    { userId: AUDITOR.id, action: 'update', resource: 'ai', meta: { operation: 'restart_moderation_worker', phase: 3 }, createdAt: at(4) },
    { userId: AUDITOR.id, action: 'login', resource: 'auth', meta: { ip: '10.0.0.7' }, createdAt: at(5) },
    { userId: AUDITOR.id, action: 'logout', resource: 'auth', meta: null, createdAt: at(6) },
  ])
})

test('each row carries its meta.phase when it is a string on an object meta, else null', async () => {
  const response = await server.request('GET', '/api/admin/activity-logs?resource=data_retention', { cookie })
  assert.equal(response.status, 200)
  const items = response.body.items as Array<Record<string, unknown>>
  assert.deepEqual(items.map(item => item.phase), [null, 'finished', 'started'], 'newest first: the string-meta row, finished, started')

  const all = await server.request('GET', '/api/admin/activity-logs?pageSize=100', { cookie })
  const byAction = (all.body.items as Array<Record<string, unknown>>).filter(item => item.resource !== 'activity_logs')
  assert.deepEqual(byAction.map(item => [item.action, item.resource, item.phase]), [
    ['logout', 'auth', null],
    ['login', 'auth', null],
    ['update', 'ai', null],
    ['delete', 'data_retention', null],
    ['delete', 'data_retention', 'finished'],
    ['delete', 'data_retention', 'started'],
  ])
})

test('the rest of the meta never reaches the response', async () => {
  const response = await server.request('GET', '/api/admin/activity-logs?resource=data_retention', { cookie })
  const serialized = JSON.stringify(response.body.items)
  assert.ok(!serialized.includes('"meta"'), 'the raw meta column was handed out')
  assert.ok(!serialized.includes('scopes') && !serialized.includes('trigger'), serialized)
  for (const item of response.body.items as Array<Record<string, unknown>>) {
    assert.deepEqual(Object.keys(item).sort(), ['action', 'createdAt', 'id', 'ip', 'mfaMethod', 'phase', 'resource', 'resourceId', 'userAgent', 'userId', 'username'])
  }
})
