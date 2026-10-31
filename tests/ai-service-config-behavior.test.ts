import assert from 'node:assert/strict'
import test, { after, beforeEach, mock } from 'node:test'

/**
 * The five AI service configurations — `server/api/admin/ai/services/index.get.ts`
 * and `[id].put.ts`: which provider and model each service (chatbot, moderation,
 * article/UI translation, editorial assistant) calls, with which system prompt,
 * temperature and token cap, and whether it is on.
 *
 * The invariants:
 *   - listing takes `ai.read` and offers each service's built-in default prompt;
 *   - editing takes `ai.update` — `ai.read` with create/delete changes nothing;
 *   - the service key and name are fixed (400), an unknown id is a 404;
 *   - numbers are clamped (temperature 0–2, max tokens 1–32 768, floored), names
 *     trimmed and cut to their columns; junk is ignored, never coerced; a body
 *     with nothing usable changes and audits nothing;
 *   - the chatbot's row is mirrored into `chatbot_settings` (prompt, model,
 *     on/off → mode, provider → wire policy) — and the service row, the mirror and
 *     the audit line commit together;
 *   - emptying the prompt or model box clears it: the edit form sends `null`
 *     (FINDING-R4-8).
 *
 * Real h3 app with the real `admin-auth` middleware; Drizzle's SQL on SQLite
 * (`_sqlite-mysql-db.ts`, real transaction).
 */

process.env.JWT_SECRET = 'ai-service-config-behavior-test-secret-0123456789'
delete process.env.MFA_ENFORCEMENT

const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const { roles, permissions, users, settings, userMfaFactors, activityLogs, aiServiceConfigs, chatbotSettings } = await import('../server/db/schema')
const harness = createSqliteMysqlDb([roles, permissions, users, settings, userMfaFactors, activityLogs, aiServiceConfigs, chatbotSettings])

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
const listServices = (await import('../server/api/admin/ai/services/index.get')).default
const updateService = (await import('../server/api/admin/ai/services/[id].put')).default
const { AI_SERVICE_DEFAULT_PROMPTS } = await import('../server/utils/ai/prompt-defaults')
const { signToken } = await import('../server/utils/auth')
const policy = await import('../server/utils/mfa/policy')

const server = await startHandlerServer([
  { method: 'get', path: '/api/admin/ai/services', handler: listServices },
  { method: 'put', path: '/api/admin/ai/services/:id', handler: updateService },
], [adminAuth])
after(() => server.close())

type Account = { id: number, username: string, roleId: number, roleName: string }
const AI_ADMIN: Account = { id: 4, username: 'quanlyai', roleId: 3, roleName: 'Quản lý AI' }
const AI_READER: Account = { id: 5, username: 'xemai', roleId: 4, roleName: 'Xem AI' }
const EDITOR: Account = { id: 6, username: 'bientap', roleId: 5, roleName: 'Biên tập' }
const cookieFor = (account: Account) =>
  `cdkt_admin=${signToken({ userId: account.id, username: account.username, roleId: account.roleId, roleName: account.roleName, tokenVersion: 0 })}`
const put = (id: number | string, body: unknown, account: Account | null = AI_ADMIN) =>
  server.request('PUT', `/api/admin/ai/services/${id}`, { ...(account ? { cookie: cookieFor(account) } : {}), body })

const CHATBOT_ID = 1
const TRANSLATION_ID = 2
const service = (id: number) => {
  const row = harness.rows(aiServiceConfigs).find(candidate => candidate.id === id)!
  return { provider: row.provider, model: row.model, systemPrompt: row.systemPrompt, temperature: Number(row.temperature), maxTokens: row.maxTokens, isActive: row.isActive, updatedBy: row.updatedBy }
}
const chatbot = () => {
  const row = harness.rows(chatbotSettings)[0]!
  return { systemPrompt: row.systemPrompt, model: row.model, mode: row.mode, providerPolicy: row.providerPolicy, updatedBy: row.updatedBy }
}
const audit = () => harness.rows(activityLogs).map(row => ({ userId: row.userId, action: row.action, resource: row.resource, resourceId: row.resourceId, meta: row.meta }))
const snapshot = () => ({ chatbotService: service(CHATBOT_ID), translation: service(TRANSLATION_ID), chatbot: chatbot(), audit: audit() })

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
  await harness.db.insert(aiServiceConfigs).values([
    { id: CHATBOT_ID, serviceKey: 'chatbot', serviceName: 'Trợ lý Chatbot', provider: 'delify', model: 'delify-5.5', systemPrompt: 'Prompt chatbot', temperature: '0.30', maxTokens: 4096, isActive: true },
    { id: TRANSLATION_ID, serviceKey: 'translation_article', serviceName: 'Dịch bài viết', provider: 'delify', model: 'delify-5.5', systemPrompt: 'Prompt dịch', temperature: '0.20', maxTokens: 8192, isActive: false },
    { id: 3, serviceKey: 'custom_unknown', serviceName: 'Tự thêm', provider: 'openai', model: null, systemPrompt: null, temperature: '0.50', maxTokens: 100, isActive: false },
  ])
  await harness.db.insert(chatbotSettings).values({ id: 1, providerPolicy: 'openai-compatible', model: 'delify-5.5', systemPrompt: 'Prompt chatbot', mode: 'ai' })
})

test('the list takes ai.read and offers each service\'s built-in default prompt', async () => {
  assert.equal((await server.request('GET', '/api/admin/ai/services')).status, 401)
  assert.equal((await server.request('GET', '/api/admin/ai/services', { cookie: cookieFor(EDITOR) })).status, 403)
  const response = await server.request('GET', '/api/admin/ai/services', { cookie: cookieFor(AI_READER) })
  assert.equal(response.status, 200)
  const rows = response.body.services as Array<{ serviceKey: string, defaultSystemPrompt: string, systemPrompt: string | null }>
  assert.deepEqual(rows.map(row => row.serviceKey), ['chatbot', 'translation_article', 'custom_unknown'])
  assert.equal(rows[0]!.defaultSystemPrompt, AI_SERVICE_DEFAULT_PROMPTS.chatbot)
  assert.ok(rows[0]!.defaultSystemPrompt.length > 0)
  assert.equal(rows[1]!.defaultSystemPrompt, AI_SERVICE_DEFAULT_PROMPTS.translation_article)
  assert.equal(rows[2]!.defaultSystemPrompt, '')
  assert.equal(rows[0]!.systemPrompt, 'Prompt chatbot')
})

test('editing takes ai.update — ai.read with create/delete, or no session, changes nothing', async () => {
  const before = snapshot()
  assert.equal((await put(TRANSLATION_ID, { isActive: true }, null)).status, 401)
  assert.equal((await put(TRANSLATION_ID, { isActive: true }, AI_READER)).status, 403)
  assert.equal((await put(CHATBOT_ID, { systemPrompt: 'x' }, EDITOR)).status, 403)
  assert.deepEqual(snapshot(), before)
})

test('the key and name are fixed, a bad id is 400, an unknown id 404; nothing usable changes nothing', async () => {
  const before = snapshot()
  assert.equal((await put('abc', { isActive: true })).status, 400)
  assert.equal((await put(0, { isActive: true })).status, 400)
  assert.equal((await put(TRANSLATION_ID, { serviceKey: 'chatbot' })).status, 400)
  assert.equal((await put(TRANSLATION_ID, { serviceName: 'Đổi tên', isActive: true })).status, 400)
  assert.equal((await put(99, { isActive: true })).status, 404)
  for (const body of [{}, { provider: '   ' }, { temperature: 'nóng' }, { temperature: true }, { maxTokens: '100' }, { isActive: 'true' }, { systemPrompt: 5 }]) {
    const response = await put(TRANSLATION_ID, body)
    assert.equal(response.status, 200, JSON.stringify(body))
    assert.equal(response.body.message, 'Không có thay đổi.', JSON.stringify(body))
  }
  assert.deepEqual(snapshot(), before)
})

test('a translation service: values clamped, trimmed and cut to their columns; audited; the chatbot is not touched', async () => {
  const before = snapshot()
  const response = await put(TRANSLATION_ID, {
    provider: `  ${'p'.repeat(40)}  `, model: `  ${'m'.repeat(70)}  `, systemPrompt: 'Dịch sang tiếng Anh.', temperature: 9, maxTokens: 99_999.9, isActive: true,
  })
  assert.equal(response.status, 200)
  assert.deepEqual(service(TRANSLATION_ID), {
    provider: 'p'.repeat(32), model: 'm'.repeat(64), systemPrompt: 'Dịch sang tiếng Anh.', temperature: 2, maxTokens: 32_768, isActive: true, updatedBy: AI_ADMIN.id,
  })
  assert.deepEqual(audit(), [{
    userId: AI_ADMIN.id, action: 'update', resource: 'ai', resourceId: TRANSLATION_ID,
    meta: { service: 'translation_article', changedFields: ['provider', 'systemPrompt', 'model', 'temperature', 'maxTokens', 'isActive', 'updatedBy'] },
  }])
  assert.deepEqual(chatbot(), before.chatbot)

  for (const [sent, kept] of [['0.75', 0.75], [-3, 0], [' 1.5 ', 1.5]] as const) {
    assert.equal((await put(TRANSLATION_ID, { temperature: sent })).status, 200)
    assert.equal(service(TRANSLATION_ID).temperature, kept, JSON.stringify(sent))
  }
  for (const [sent, kept] of [[0.4, 1], [-50, 1], [2048.9, 2048]] as const) {
    assert.equal((await put(TRANSLATION_ID, { maxTokens: sent })).status, 200)
    assert.equal(service(TRANSLATION_ID).maxTokens, kept, String(sent))
  }
})

test('the chatbot service is mirrored into chatbot_settings: prompt, model, on/off → mode, provider → wire policy', async () => {
  assert.equal((await put(CHATBOT_ID, { systemPrompt: 'Prompt mới', model: 'delify-6', isActive: false, provider: 'anthropic' })).status, 200)
  assert.deepEqual(chatbot(), { systemPrompt: 'Prompt mới', model: 'delify-6', mode: 'knowledge', providerPolicy: 'anthropic', updatedBy: AI_ADMIN.id })
  assert.equal((await put(CHATBOT_ID, { isActive: true, provider: 'delify' })).status, 200)
  assert.deepEqual(chatbot(), { systemPrompt: 'Prompt mới', model: 'delify-6', mode: 'ai', providerPolicy: 'openai-compatible', updatedBy: AI_ADMIN.id })
  // Fields with no mirror (temperature, token cap) leave chatbot_settings alone.
  harness.sqlite.prepare('UPDATE chatbot_settings SET updated_by = NULL').run()
  assert.equal((await put(CHATBOT_ID, { temperature: 0.9, maxTokens: 512 })).status, 200)
  assert.equal(chatbot().updatedBy, null)
  assert.deepEqual(audit().map(line => (line.meta as { service: string }).service), ['chatbot', 'chatbot', 'chatbot'])
})

test('the service row, the chatbot mirror and the audit line commit together', async () => {
  const before = snapshot()
  harness.failNext(/^insert into `activity_logs`/)
  assert.equal((await put(CHATBOT_ID, { systemPrompt: 'Không được lưu', isActive: false })).status, 500)
  assert.deepEqual(snapshot(), before)

  harness.failNext(/^update `chatbot_settings`/)
  assert.equal((await put(CHATBOT_ID, { model: 'không-được-lưu' })).status, 500)
  assert.deepEqual(snapshot(), before)
})

/**
 * FINDING-R4-8 — severity low. The service edit form sends `systemPrompt:
 * serviceForm.systemPrompt || null` and `model: serviceForm.model || null`
 * (`AiServicesTab.vue`); the handler only took strings — its own `'' → null`
 * shows clearing was meant — so emptying either box was ignored while the page
 * said "Đã lưu cấu hình dịch vụ." For the chatbot, the mirror kept the old value
 * too.
 */
test('FINDING-R4-8: emptying the prompt or the model box clears it, on the service and on the chatbot mirror', async () => {
  const response = await put(CHATBOT_ID, { systemPrompt: null, model: null })
  assert.equal(response.status, 200)
  assert.equal(response.body.message, undefined)
  assert.equal(service(CHATBOT_ID).systemPrompt, null)
  assert.equal(service(CHATBOT_ID).model, null)
  assert.equal(chatbot().systemPrompt, null)
  assert.equal(chatbot().model, null)
  assert.deepEqual(audit()[0]!.meta, { service: 'chatbot', changedFields: ['systemPrompt', 'model', 'updatedBy'] })
})
