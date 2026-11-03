import assert from 'node:assert/strict'
import test, { after, beforeEach, mock } from 'node:test'

/**
 * The AI provider list and its two delete routes —
 * `server/api/admin/ai/providers/index.get.ts`, `[id].delete.ts`,
 * `bulk-delete.post.ts`. A provider row holds an encrypted API key and the base
 * URL it is sent to; the services (`ai_service_configs`) name a provider to call.
 *
 * The invariants:
 *   - listing takes `ai.read` and returns the last four characters of the key,
 *     never the envelope (ciphertext, nonce, tag, key id); each card carries its
 *     model counts from `ai_model_pricing`;
 *   - deleting takes `ai.update` — `ai.read` with create/delete deletes nothing;
 *   - a provider a service still uses is not deleted (409, naming the service),
 *     and in a bulk delete one such provider stops the whole batch;
 *   - the delete and its audit line commit together; a bulk delete also removes
 *     the provider's price rows in that transaction; a single delete leaves them
 *     (pinned as it behaves — see the R4 notes);
 *   - the audit names what was deleted, not what was asked (FINDING-R4-5).
 *
 * Real h3 app with the real `admin-auth` middleware; Drizzle's SQL on SQLite
 * (`_sqlite-mysql-db.ts`, real transaction).
 */

process.env.JWT_SECRET = 'ai-provider-delete-behavior-test-secret-0123456789'
process.env.CHATBOT_ENCRYPTION_SECRET = Buffer.alloc(32, 7).toString('base64')
delete process.env.MFA_ENFORCEMENT

const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const { roles, permissions, users, settings, userMfaFactors, activityLogs, aiProviders, aiServiceConfigs, aiModelPricing } = await import('../server/db/schema')
const harness = createSqliteMysqlDb([roles, permissions, users, settings, userMfaFactors, activityLogs, aiProviders, aiServiceConfigs, aiModelPricing])

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
const listProviders = (await import('../server/api/admin/ai/providers/index.get')).default
const deleteProvider = (await import('../server/api/admin/ai/providers/[id].delete')).default
const bulkDeleteProviders = (await import('../server/api/admin/ai/providers/bulk-delete.post')).default
const { encryptAiSecret } = await import('../server/utils/ai/crypto')
const { signToken } = await import('../server/utils/auth')
const policy = await import('../server/utils/mfa/policy')

const server = await startHandlerServer([
  { method: 'get', path: '/api/admin/ai/providers', handler: listProviders },
  { method: 'post', path: '/api/admin/ai/providers/bulk-delete', handler: bulkDeleteProviders },
  { method: 'delete', path: '/api/admin/ai/providers/:id', handler: deleteProvider },
], [adminAuth])
after(() => server.close())

type Account = { id: number, username: string, roleId: number, roleName: string }
const AI_ADMIN: Account = { id: 4, username: 'quanlyai', roleId: 3, roleName: 'Quản lý AI' }
const AI_READER: Account = { id: 5, username: 'xemai', roleId: 4, roleName: 'Xem AI' }
const EDITOR: Account = { id: 6, username: 'bientap', roleId: 5, roleName: 'Biên tập' }
const cookieFor = (account: Account) =>
  `cdkt_admin=${signToken({ userId: account.id, username: account.username, roleId: account.roleId, roleName: account.roleName, tokenVersion: 0 })}`
const send = (method: string, path: string, body?: unknown, account: Account | null = AI_ADMIN) =>
  server.request(method, path, { ...(account ? { cookie: cookieFor(account) } : {}), ...(body === undefined ? {} : { body }) })

const SECRET = 'sk-provider-key-NOT-FOR-THE-LIST-9876'
const envelope = encryptAiSecret(SECRET)

const providerNames = () => harness.rows(aiProviders).map(row => row.provider).sort()
const priceModels = () => harness.rows(aiModelPricing).map(row => row.model).sort()
const audit = () => harness.rows(activityLogs).map(row => ({ userId: row.userId, action: row.action, resource: row.resource, resourceId: row.resourceId, meta: row.meta }))
const snapshot = () => ({ providers: providerNames(), prices: priceModels(), audit: audit() })

beforeEach(async () => {
  harness.reset()
  policy.clearMfaPolicyCache()
  policy.clearMfaFactorCache()
  await harness.db.insert(roles).values([AI_ADMIN, AI_READER, EDITOR].map(account => ({ id: account.roleId, name: account.roleName, isSystem: false })))
  await harness.db.insert(permissions).values([
    { roleId: AI_ADMIN.roleId, resource: 'ai', canRead: true, canUpdate: true },
    { roleId: AI_READER.roleId, resource: 'ai', canRead: true, canCreate: true, canDelete: true },
    { roleId: EDITOR.roleId, resource: 'news', canRead: true, canCreate: true, canUpdate: true, canDelete: true },
  ])
  await harness.db.insert(users).values([AI_ADMIN, AI_READER, EDITOR].map(account => ({
    id: account.id, username: account.username, email: `${account.username}@example.vn`, passwordHash: 'x', roleId: account.roleId,
  })))
  await harness.db.insert(aiProviders).values([
    { id: 1, provider: 'delify', label: 'Delify Router', baseUrl: 'https://router.delify.example/v1', isActive: true, apiKeyCiphertext: envelope.ciphertext, apiKeyNonce: envelope.nonce, apiKeyAuthTag: envelope.authTag, apiKeyVersion: envelope.version, apiKeyKeyId: envelope.keyId, apiKeyLastFour: '9876' },
    { id: 2, provider: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.example/v1', isActive: false },
    { id: 3, provider: 'deepseek', label: 'DeepSeek', baseUrl: null, isActive: false },
  ])
  await harness.db.insert(aiServiceConfigs).values({ serviceKey: 'chatbot', serviceName: 'Trợ lý Chatbot', provider: 'delify', model: 'delify-5.5' })
  await harness.db.insert(aiModelPricing).values([
    { model: 'delify-5.5', provider: 'delify', isActive: true, promptCostPerMillion: '2', completionCostPerMillion: '10' },
    { model: 'delify-old', provider: 'delify', isActive: false, promptCostPerMillion: '1', completionCostPerMillion: '5' },
    { model: 'gpt-4o-mini', provider: 'openai', isActive: true, promptCostPerMillion: '0.15', completionCostPerMillion: '0.6' },
    { model: 'deepseek-chat', provider: 'deepseek', isActive: true, promptCostPerMillion: '0.27', completionCostPerMillion: '1.1' },
  ])
})

test('the list takes ai.read and shows the last four of the key — never the envelope — with model counts per provider', async () => {
  assert.equal((await send('GET', '/api/admin/ai/providers', undefined, null)).status, 401)
  assert.equal((await send('GET', '/api/admin/ai/providers', undefined, EDITOR)).status, 403)
  const response = await send('GET', '/api/admin/ai/providers', undefined, AI_READER)
  assert.equal(response.status, 200)
  const rows = response.body.providers as Array<Record<string, unknown>>
  assert.deepEqual(rows.map(row => [row.provider, row.apiKeyLastFour, row.totalModels, row.activeModels]), [
    ['delify', '9876', 2, 1], ['openai', null, 1, 1], ['deepseek', null, 1, 1],
  ])
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), ['activeModels', 'apiKeyLastFour', 'baseUrl', 'id', 'isActive', 'label', 'provider', 'totalModels', 'updatedAt'])
  }
  const text = JSON.stringify(response.body)
  assert.ok(!text.includes(envelope.ciphertext) && !text.includes(envelope.nonce) && !text.includes(SECRET))
})

test('deleting takes ai.update — ai.read with create/delete, or no session, deletes nothing', async () => {
  const before = snapshot()
  for (const account of [AI_READER, EDITOR]) {
    assert.equal((await send('DELETE', '/api/admin/ai/providers/2', undefined, account)).status, 403)
    assert.equal((await send('POST', '/api/admin/ai/providers/bulk-delete', { ids: [2, 3] }, account)).status, 403)
  }
  assert.equal((await send('DELETE', '/api/admin/ai/providers/2', undefined, null)).status, 401)
  assert.deepEqual(snapshot(), before)
})

test('delete one: bad id → 400, unknown → 404, used by a service → 409 naming it; nothing changes', async () => {
  const before = snapshot()
  assert.equal((await send('DELETE', '/api/admin/ai/providers/abc')).status, 400)
  assert.equal((await send('DELETE', '/api/admin/ai/providers/0')).status, 400)
  assert.equal((await send('DELETE', '/api/admin/ai/providers/99')).status, 404)
  const linked = await send('DELETE', '/api/admin/ai/providers/1')
  assert.equal(linked.status, 409)
  assert.match(String(linked.body.statusMessage ?? linked.body.message), /delify.*chatbot/)
  assert.deepEqual(snapshot(), before)
})

test('delete one: the row and its audit line commit together; the provider\'s price rows stay', async () => {
  const before = snapshot()
  harness.failNext(/^insert into `activity_logs`/)
  assert.equal((await send('DELETE', '/api/admin/ai/providers/2')).status, 500)
  assert.deepEqual(snapshot(), before)

  assert.equal((await send('DELETE', '/api/admin/ai/providers/2')).status, 200)
  assert.deepEqual(providerNames(), ['deepseek', 'delify'])
  assert.deepEqual(priceModels(), ['deepseek-chat', 'delify-5.5', 'delify-old', 'gpt-4o-mini'])
  assert.deepEqual(audit(), [{ userId: AI_ADMIN.id, action: 'delete', resource: 'ai', resourceId: 2, meta: { provider: 'openai' } }])
})

test('bulk delete: a list of ids is required; none found → 404; one provider in use stops the whole batch', async () => {
  const before = snapshot()
  for (const body of [{}, { ids: '2' }, { ids: [] }, { ids: [0, -1, '2', null, -0.5] }]) {
    assert.equal((await send('POST', '/api/admin/ai/providers/bulk-delete', body)).status, 400, JSON.stringify(body))
  }
  assert.equal((await send('POST', '/api/admin/ai/providers/bulk-delete', { ids: [98, 99] })).status, 404)
  const linked = await send('POST', '/api/admin/ai/providers/bulk-delete', { ids: [2, 1] })
  assert.equal(linked.status, 409)
  assert.match(String(linked.body.statusMessage ?? linked.body.message), /"delify" đang dùng cho Trợ lý Chatbot \(chatbot\)/)
  assert.deepEqual(snapshot(), before)
})

test('bulk delete: providers, their price rows and the audit line commit together', async () => {
  const before = snapshot()
  harness.failNext(/^insert into `activity_logs`/)
  assert.equal((await send('POST', '/api/admin/ai/providers/bulk-delete', { ids: [2, 3] })).status, 500)
  assert.deepEqual(snapshot(), before)

  const response = await send('POST', '/api/admin/ai/providers/bulk-delete', { ids: [2, 3] })
  assert.deepEqual(response.body, { ok: true, deleted: 2 })
  assert.deepEqual(providerNames(), ['delify'])
  assert.deepEqual(priceModels(), ['delify-5.5', 'delify-old'])
  const [line] = audit()
  assert.deepEqual({ ...line, meta: null }, { userId: AI_ADMIN.id, action: 'delete', resource: 'ai', resourceId: null, meta: null })
  const meta = line!.meta as { type: string, count: number, providers: string[] }
  assert.deepEqual({ ...meta, providers: [...meta.providers].sort() }, { type: 'provider_bulk_delete', count: 2, providers: ['deepseek', 'openai'] })
})

/** FINDING-R4-5 (provider half): the audit counted the ids sent — duplicates and ids that do not exist included. */
test('FINDING-R4-5: the bulk-delete audit counts the providers deleted, not the ids sent', async () => {
  const response = await send('POST', '/api/admin/ai/providers/bulk-delete', { ids: [2, 2, 2, 77] })
  assert.deepEqual(response.body, { ok: true, deleted: 1 })
  assert.deepEqual(audit().map(line => line.meta), [{ type: 'provider_bulk_delete', count: 1, providers: ['openai'] }])
})
