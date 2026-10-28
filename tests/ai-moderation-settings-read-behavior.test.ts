import assert from 'node:assert/strict'
import test, { after, beforeEach, mock } from 'node:test'

/**
 * `GET /api/admin/ai/moderation/settings` (server/api/admin/ai/moderation/settings.get.ts)
 * — the page an officer reads to know how comments and chat are screened.
 *
 * The invariants:
 *   - it takes `ai.read`;
 *   - the prompt shown is the prompt `callAi` runs (`effectiveSystemPrompt`): the stored
 *     one, or the built-in default when the stored one is null, empty or blank. Before
 *     FINDING-R4-9 the page showed the default for `null` while the gateway sent no
 *     system prompt at all, and showed an empty box for `''` — the same state the
 *     gateway now runs on the default;
 *   - the default is always offered beside it, for "restore default";
 *   - no configuration row → `keyword_only` with the seeded provider/model;
 *   - only active providers and models are offered, providers without key material.
 *
 * Real h3 app with the real `admin-auth` middleware; Drizzle's SQL on SQLite.
 */

process.env.JWT_SECRET = 'ai-moderation-settings-read-test-secret-0123456789'
delete process.env.MFA_ENFORCEMENT

const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const { roles, permissions, users, settings, userMfaFactors, aiServiceConfigs, aiProviders, aiModelPricing } = await import('../server/db/schema')
const harness = createSqliteMysqlDb([roles, permissions, users, settings, userMfaFactors, aiServiceConfigs, aiProviders, aiModelPricing])

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
const readSettings = (await import('../server/api/admin/ai/moderation/settings.get')).default
const { DEFAULT_MODERATION_SYSTEM_PROMPT } = await import('../server/utils/ai/prompt-defaults')
const { signToken } = await import('../server/utils/auth')
const policy = await import('../server/utils/mfa/policy')

const server = await startHandlerServer([{ method: 'get', path: '/api/admin/ai/moderation/settings', handler: readSettings }], [adminAuth])
after(() => server.close())

type Account = { id: number, username: string, roleId: number, roleName: string }
const AI_READER: Account = { id: 4, username: 'xemai', roleId: 3, roleName: 'Xem AI' }
const EDITOR: Account = { id: 5, username: 'bientap', roleId: 4, roleName: 'Biên tập' }
const cookieFor = (account: Account) =>
  `cdkt_admin=${signToken({ userId: account.id, username: account.username, roleId: account.roleId, roleName: account.roleName, tokenVersion: 0 })}`
const read = (account: Account | null = AI_READER) =>
  server.request('GET', '/api/admin/ai/moderation/settings', account ? { cookie: cookieFor(account) } : {})
const setPrompt = (value: string | null) => harness.sqlite.prepare("UPDATE ai_service_configs SET system_prompt = ? WHERE service_key = 'moderation'").run(value)

beforeEach(async () => {
  harness.reset()
  policy.clearMfaPolicyCache()
  policy.clearMfaFactorCache()
  await harness.db.insert(roles).values([AI_READER, EDITOR].map(account => ({ id: account.roleId, name: account.roleName, isSystem: false })))
  await harness.db.insert(permissions).values([
    { roleId: AI_READER.roleId, resource: 'ai', canRead: true },
    { roleId: EDITOR.roleId, resource: 'news', canRead: true, canCreate: true, canUpdate: true, canDelete: true },
  ])
  await harness.db.insert(users).values([AI_READER, EDITOR].map(account => ({
    id: account.id, username: account.username, email: `${account.username}@example.vn`, passwordHash: 'x', roleId: account.roleId,
  })))
  await harness.db.insert(aiServiceConfigs).values({ serviceKey: 'moderation', serviceName: 'Kiểm duyệt nội dung', provider: 'openai', model: 'gpt-4o-mini', systemPrompt: 'Prompt riêng', isActive: true })
  await harness.db.insert(aiProviders).values([
    { provider: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.example/v1', isActive: true, apiKeyCiphertext: 'CIPHERTEXT-NOT-FOR-THE-PAGE', apiKeyNonce: 'n', apiKeyAuthTag: 't', apiKeyVersion: 1, apiKeyKeyId: 'k', apiKeyLastFour: '1234' },
    { provider: 'deepseek', label: 'DeepSeek', baseUrl: null, isActive: false },
  ])
  await harness.db.insert(aiModelPricing).values([
    { model: 'gpt-4o-mini', provider: 'openai', isActive: true, promptCostPerMillion: '0.15', completionCostPerMillion: '0.6' },
    { model: 'gpt-old', provider: 'openai', isActive: false, promptCostPerMillion: '1', completionCostPerMillion: '2' },
  ])
})

test('it takes ai.read: no session → 401, other resources → 403', async () => {
  assert.equal((await read(null)).status, 401)
  assert.equal((await read(EDITOR)).status, 403)
  assert.equal((await read()).status, 200)
})

test('a stored prompt is shown as stored, with the default offered beside it; only active providers/models, no key material', async () => {
  const { body } = await read()
  assert.deepEqual(body.settings, {
    enabled: true, mode: 'ai', provider: 'openai', model: 'gpt-4o-mini', systemPrompt: 'Prompt riêng', defaultSystemPrompt: DEFAULT_MODERATION_SYSTEM_PROMPT,
  })
  assert.deepEqual(body.activeProviders, [{ id: 1, provider: 'openai', label: 'OpenAI', isActive: true }])
  assert.deepEqual((body.activeModels as Array<{ model: string }>).map(row => row.model), ['gpt-4o-mini'])
  assert.ok(!JSON.stringify(body).includes('CIPHERTEXT'))
})

test('FINDING-R4-9: a null, empty or blank stored prompt is shown as the default — the prompt the gateway now runs', async () => {
  for (const stored of [null, '', '   \n']) {
    setPrompt(stored)
    const { body } = await read()
    assert.equal((body.settings as { systemPrompt: string }).systemPrompt, DEFAULT_MODERATION_SYSTEM_PROMPT, JSON.stringify(stored))
  }
})

// Pinned as it behaves: `enabled` reads true while `mode` says keyword_only (the gateway finds no row → no AI).
test('no configuration row: keyword_only with the seeded provider and model, the default prompt shown', async () => {
  harness.sqlite.prepare('DELETE FROM ai_service_configs').run()
  const { body } = await read()
  assert.deepEqual(body.settings, {
    enabled: true, mode: 'keyword_only', provider: 'delify', model: 'delify-5.5', systemPrompt: DEFAULT_MODERATION_SYSTEM_PROMPT, defaultSystemPrompt: DEFAULT_MODERATION_SYSTEM_PROMPT,
  })
})
