import assert from 'node:assert/strict'
import test, { after, beforeEach, mock } from 'node:test'

/**
 * Three moderation routes of the AI panel that no suite ran (pinned before their queries moved
 * out of the handlers — behaviour first, then the move):
 *   - `PUT /api/admin/ai/moderation/settings` (server/api/admin/ai/moderation/settings.put.ts)
 *     — switch AI screening on/off, pick its provider/model, edit its prompt;
 *   - `GET /api/admin/ai/moderation/worker-status` (`worker-status.get.ts`) — the status card;
 *   - `GET /api/admin/ai/moderation/rules` (`rules.get.ts`) — the rule list.
 *
 * The invariants, as the routes behave today:
 *   - the write takes `ai.update`, the reads `ai.read`;
 *   - the `moderation` configuration row is updated and audited in ONE transaction: a failed audit
 *     insert leaves the row as it was (and the answer cache is not bumped);
 *   - `enabled` (a boolean) wins over `mode`; provider/model are trimmed and cut to their columns
 *     (32 / 64); the prompt is trimmed; `updatedBy` is always written, so `changedFields` always
 *     names it;
 *   - with no configuration row nothing is updated, yet the audit row is written (resource id 1)
 *     — pinned as it behaves;
 *   - the answer cache is bumped after the commit, outside the transaction;
 *   - the status card counts PENDING queue rows only and reads the configuration row, with the
 *     seeded defaults when there is none; the rule list is ordered by category, newest first.
 *
 * Real h3 app with the real `admin-auth` middleware; Drizzle's SQL on SQLite (real transaction).
 * The worker's in-memory counters and the rescan job are stand-ins (not what is pinned here).
 */

process.env.JWT_SECRET = 'ai-moderation-settings-write-test-secret-0123456789'
delete process.env.MFA_ENFORCEMENT

const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const { roles, permissions, users, settings, userMfaFactors, activityLogs, aiServiceConfigs, aiModerationQueue, aiModerationRules } = await import('../server/db/schema')
const harness = createSqliteMysqlDb([roles, permissions, users, settings, userMfaFactors, activityLogs, aiServiceConfigs, aiModerationQueue, aiModerationRules])

/** Each bump, and whether a transaction was still open when it ran (a pool read throws inside one). */
const bumps: Array<{ insideTransaction: boolean }> = []

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
mock.module('../server/services/chatbot-answer-cache', {
  namedExports: {
    bumpAnswerCacheVersion: async () => {
      let insideTransaction = false
      try { await harness.db.select({ id: aiServiceConfigs.id }).from(aiServiceConfigs) } catch { insideTransaction = true }
      bumps.push({ insideTransaction })
      return 1
    },
  },
})
const WORKER_STATS = { processedCount: 3, flaggedCount: 1, errorCount: 0 }
const RESCAN_STATUS = { state: 'idle', progress: null, summary: null }
mock.module('../server/services/moderation-worker', { namedExports: { getWorkerStats: () => ({ ...WORKER_STATS }) } })
mock.module('../server/services/moderation-rescan-job', { namedExports: { getModerationRescanStatus: () => ({ ...RESCAN_STATUS }) } })

const { installH3Globals, startHandlerServer } = await import('./_h3-handler-server')
installH3Globals()
const adminAuth = (await import('../server/middleware/admin-auth')).default
const writeSettings = (await import('../server/api/admin/ai/moderation/settings.put')).default
const workerStatus = (await import('../server/api/admin/ai/moderation/worker-status.get')).default
const listRules = (await import('../server/api/admin/ai/moderation/rules.get')).default
const { signToken } = await import('../server/utils/auth')
const policy = await import('../server/utils/mfa/policy')

const server = await startHandlerServer([
  { method: 'put', path: '/api/admin/ai/moderation/settings', handler: writeSettings },
  { method: 'get', path: '/api/admin/ai/moderation/worker-status', handler: workerStatus },
  { method: 'get', path: '/api/admin/ai/moderation/rules', handler: listRules },
], [adminAuth])
after(() => server.close())

type Account = { id: number, username: string, roleId: number, roleName: string }
type Json = Record<string, unknown>
const AI_UPDATER: Account = { id: 4, username: 'suaai', roleId: 3, roleName: 'Sửa AI' }
const AI_READER: Account = { id: 5, username: 'xemai', roleId: 4, roleName: 'Xem AI' }
const cookieFor = (account: Account) =>
  `cdkt_admin=${signToken({ userId: account.id, username: account.username, roleId: account.roleId, roleName: account.roleName, tokenVersion: 0 })}`
const put = (body: unknown, account: Account | null = AI_UPDATER) =>
  server.request('PUT', '/api/admin/ai/moderation/settings', { ...(account ? { cookie: cookieFor(account) } : {}), body })
const get = (path: string, account: Account | null = AI_READER) =>
  server.request('GET', path, account ? { cookie: cookieFor(account) } : {})
const config = () => harness.rows(aiServiceConfigs).find(row => row.serviceKey === 'moderation')
const audits = () => harness.rows(activityLogs)

const SEEDED = { id: 9, serviceKey: 'moderation', serviceName: 'Kiểm duyệt nội dung', provider: 'openai', model: 'gpt-4o-mini', systemPrompt: 'Prompt cũ', isActive: true }

beforeEach(async () => {
  harness.reset()
  bumps.length = 0
  policy.clearMfaPolicyCache()
  policy.clearMfaFactorCache()
  await harness.db.insert(roles).values([AI_UPDATER, AI_READER].map(account => ({ id: account.roleId, name: account.roleName, isSystem: false })))
  await harness.db.insert(permissions).values([
    { roleId: AI_UPDATER.roleId, resource: 'ai', canRead: true, canUpdate: true },
    { roleId: AI_READER.roleId, resource: 'ai', canRead: true },
  ])
  await harness.db.insert(users).values([AI_UPDATER, AI_READER].map(account => ({
    id: account.id, username: account.username, email: `${account.username}@example.vn`, passwordHash: 'x', roleId: account.roleId,
  })))
  await harness.db.insert(aiServiceConfigs).values([SEEDED, { id: 10, serviceKey: 'chatbot', serviceName: 'Chatbot', provider: 'openai', model: 'gpt-4o', isActive: true }])
})

// ─── PUT settings ───────────────────────────────────────────────────────────────

test('the write takes ai.update: no session → 401, ai.read only → 403; nothing written, nothing bumped', async () => {
  assert.equal((await put({ enabled: false }, null)).status, 401)
  assert.equal((await put({ enabled: false }, AI_READER)).status, 403)
  assert.equal(config()!.isActive, true)
  assert.deepEqual(audits(), [])
  assert.deepEqual(bumps, [])
})

test('the configuration row and its audit row commit together; the bump runs after the commit', async () => {
  const longProvider = `  ${'p'.repeat(40)}  `
  const longModel = `  ${'m'.repeat(80)}  `
  const response = await put({ enabled: false, mode: 'ai', provider: longProvider, model: longModel, systemPrompt: '  Prompt mới  ' })
  assert.equal(response.status, 200)
  assert.deepEqual(response.body, { ok: true })
  const row = config()!
  assert.equal(row.isActive, false, '`enabled` wins over `mode`')
  assert.equal(row.provider, 'p'.repeat(32))
  assert.equal(row.model, 'm'.repeat(64))
  assert.equal(row.systemPrompt, 'Prompt mới')
  assert.equal(row.updatedBy, AI_UPDATER.id)
  assert.equal(harness.rows(aiServiceConfigs).find(r => r.serviceKey === 'chatbot')!.provider, 'openai', 'only the moderation row changes')
  const [audit, ...rest] = audits()
  assert.deepEqual(rest, [])
  assert.equal(audit!.userId, AI_UPDATER.id)
  assert.equal(audit!.action, 'update')
  assert.equal(audit!.resource, 'ai')
  assert.equal(audit!.resourceId, SEEDED.id)
  assert.deepEqual(audit!.meta, { type: 'update_moderation_settings', changedFields: ['isActive', 'provider', 'model', 'systemPrompt', 'updatedBy'] })
  assert.deepEqual(bumps, [{ insideTransaction: false }])
  // The read, the update and the audit insert ran inside the transaction, in that order.
  assert.deepEqual(harness.txStatements.map(sql => sql.split(' ').slice(0, 3).join(' ')), [
    'select `id` from',
    'update `ai_service_configs` set',
    'insert into `activity_logs`',
  ])
})

test('`mode` alone switches screening; an empty body still writes updatedBy and an audit row', async () => {
  await put({ mode: 'keyword_only' })
  assert.equal(config()!.isActive, false)
  await put({ mode: 'ai' })
  assert.equal(config()!.isActive, true)
  await put({ mode: 'other', provider: '   ', model: '' })
  assert.equal(config()!.isActive, true, 'an unknown mode changes nothing')
  assert.equal(config()!.provider, 'openai', 'a blank provider is ignored')
  assert.deepEqual(audits().map(a => (a.meta as Json).changedFields), [['isActive', 'updatedBy'], ['isActive', 'updatedBy'], ['updatedBy']])
  assert.equal(bumps.length, 3)
})

test('no configuration row: nothing is updated, the audit row is still written with resource id 1', async () => {
  harness.sqlite.prepare("DELETE FROM ai_service_configs WHERE service_key = 'moderation'").run()
  const response = await put({ enabled: true, systemPrompt: 'x' })
  assert.equal(response.status, 200)
  assert.equal(config(), undefined)
  assert.ok(!harness.statements.some(sql => sql.startsWith('update')), 'no UPDATE without a row')
  const [audit] = audits()
  assert.equal(audit!.resourceId, 1)
  assert.deepEqual((audit!.meta as Json).changedFields, ['isActive', 'systemPrompt', 'updatedBy'])
  assert.equal(bumps.length, 1)
})

test('a failed audit insert rolls the configuration change back; no bump', async () => {
  harness.failNext(/^insert into `activity_logs`/, { errno: 1452 })
  const response = await put({ enabled: false, provider: 'deepseek' })
  assert.equal(response.status, 500)
  assert.equal(config()!.isActive, true)
  assert.equal(config()!.provider, 'openai')
  assert.deepEqual(audits(), [])
  assert.deepEqual(bumps, [])
})

// ─── GET worker-status ─────────────────────────────────────────────────────────

test('worker status takes ai.read and counts pending queue rows only, with the configuration row', async () => {
  assert.equal((await get('/api/admin/ai/moderation/worker-status', null)).status, 401)
  await harness.db.insert(aiModerationQueue).values([
    { targetType: 'comment', targetId: 1, contentSnippet: 'a', flaggedReason: 'r', status: 'pending' },
    { targetType: 'comment', targetId: 2, contentSnippet: 'b', flaggedReason: 'r', status: 'pending' },
    { targetType: 'comment', targetId: 3, contentSnippet: 'c', flaggedReason: 'r', status: 'approved' },
  ])
  const { status, body } = await get('/api/admin/ai/moderation/worker-status')
  assert.equal(status, 200)
  assert.deepEqual(body, {
    ok: true,
    rescan: RESCAN_STATUS,
    worker: { ...WORKER_STATS, pendingQueueCount: 2, aiServiceActive: true, aiProvider: 'openai', aiModel: 'gpt-4o-mini' },
  })
})

test('worker status with no configuration row: AI off, the seeded provider and model', async () => {
  harness.sqlite.prepare('DELETE FROM ai_service_configs').run()
  const { body } = await get('/api/admin/ai/moderation/worker-status')
  assert.deepEqual(body.worker, { ...WORKER_STATS, pendingQueueCount: 0, aiServiceActive: false, aiProvider: 'delify', aiModel: 'delify-5.5' })
})

// ─── GET rules ────────────────────────────────────────────────────────────────

test('the rule list takes ai.read and is ordered by category, newest first within one', async () => {
  assert.equal((await get('/api/admin/ai/moderation/rules', null)).status, 401)
  await harness.db.insert(aiModerationRules).values([
    { id: 1, category: 'spam_fraud', pattern: 'mua ngay' },
    { id: 2, category: 'anti_state', pattern: 'abc', isEnabled: false },
    { id: 3, category: 'spam_fraud', pattern: 'khuyến mãi' },
    { id: 4, category: 'anti_state', pattern: 'xyz' },
  ])
  const { status, body } = await get('/api/admin/ai/moderation/rules')
  assert.equal(status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.count, 4)
  assert.deepEqual((body.rules as Json[]).map(rule => [rule.id, rule.category, rule.pattern, rule.isEnabled]), [
    [4, 'anti_state', 'xyz', true],
    [2, 'anti_state', 'abc', false],
    [3, 'spam_fraud', 'khuyến mãi', true],
    [1, 'spam_fraud', 'mua ngay', true],
  ])
})
