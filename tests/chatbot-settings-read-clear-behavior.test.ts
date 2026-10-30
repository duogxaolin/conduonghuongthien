import assert from 'node:assert/strict'
import test, { after, beforeEach } from 'node:test'

/**
 * The chatbot settings page's read, and the key "clear":
 *   GET  /api/admin/chatbot/settings        (index.get.ts — chatbot_settings.read)
 *   POST /api/admin/chatbot/settings/clear  (clear.post.ts — super admin only)
 *
 * The invariants:
 *   - the read creates the single settings row with the defaults on first use (a GET
 *     that writes, like ai/budget);
 *   - once an AI service config `chatbot` and its provider exist, the AI fields of the
 *     form come from them (spec R11.4) — model, prompt, provider policy, base URL and
 *     the host it allows, "enabled", whether a key is stored — and the key itself, its
 *     envelope and the stored prompt never leave the server inside `settings`
 *     (`currentSystemPrompt` is the prompt the page edits, by design);
 *   - clear removes the stored chatbot key in one transaction with its audit row, and
 *     only a super admin may do it — a role holding every chatbot_settings flag may not.
 *
 * Real h3 app + `admin-auth`, SQL on SQLite (`_ai-route-harness.ts`).
 */

const { startAiRouteHarness, SECRET, containsSecret } = await import('./_ai-route-harness')
const h = await startAiRouteHarness({
  extraTables: s => [s.chatbotSettings, s.activityLogs],
  routes: async load => [
    { method: 'get', path: '/api/admin/chatbot/settings', handler: await load('../server/api/admin/chatbot/settings/index.get') },
    { method: 'post', path: '/api/admin/chatbot/settings/clear', handler: await load('../server/api/admin/chatbot/settings/clear.post') },
  ],
})
after(() => h.server.close())
const { chatbotSettings, aiProviders, aiServiceConfigs, activityLogs } = h.schema
const { encryptChatbotSecret } = await import('../server/utils/chatbot/crypto')

type Json = Record<string, unknown>
type Account = Awaited<ReturnType<typeof h.account>>
let reader: Account
let allFlags: Account
let superAdmin: Account

beforeEach(async () => {
  h.reset()
  reader = await h.account([{ resource: 'chatbot_settings', canRead: true }], 'xem')
  allFlags = await h.account([{ resource: 'chatbot_settings', canRead: true, canCreate: true, canUpdate: true, canDelete: true }], 'quantri')
  superAdmin = await h.account([], 'sieuquantri')
  h.harness.sqlite.prepare('UPDATE roles SET is_system = 1 WHERE id = ?').run(superAdmin.roleId)
})

const CHATBOT_KEY = 'sk-chatbot-legacy-KEY-0123456789-abcdefWXYZ'
async function storeChatbotKey() {
  const envelope = encryptChatbotSecret(CHATBOT_KEY)
  await h.harness.db.insert(chatbotSettings).values({
    id: 1, enabled: true, providerPolicy: 'openai-compatible', baseUrl: 'https://legacy.example/v1', model: 'legacy-model',
    systemPrompt: 'Lời nhắc cũ', allowedHosts: ['legacy.example'], mode: 'ai', knowledgeGreeting: 'Xin chào',
    apiKeyCiphertext: envelope.ciphertext, apiKeyNonce: envelope.nonce, apiKeyAuthTag: envelope.authTag,
    apiKeyVersion: envelope.version, apiKeyKeyId: envelope.keyId, apiKeyLastFour: envelope.lastFour,
  } as typeof chatbotSettings.$inferInsert)
}
const read = async (who: Account = reader) => {
  const response = await h.request('GET', '/api/admin/chatbot/settings', who)
  assert.equal(response.status, 200, JSON.stringify(response.body))
  return response.body as { settings: Json, currentSystemPrompt: string, currentProvider: string, currentModel: string }
}

test('read needs chatbot_settings.read; clear needs a super admin, whatever chatbot_settings flags a role holds', async () => {
  const outsider = await h.account([{ resource: 'settings', canRead: true, canUpdate: true }], 'caidat')
  assert.equal((await h.request('GET', '/api/admin/chatbot/settings', null)).status, 401)
  assert.equal((await h.request('GET', '/api/admin/chatbot/settings', outsider)).status, 403)
  await storeChatbotKey()
  for (const who of [reader, allFlags, outsider]) {
    assert.equal((await h.request('POST', '/api/admin/chatbot/settings/clear', who)).status, 403)
  }
  assert.ok(h.harness.rows(chatbotSettings)[0]!.apiKeyCiphertext, 'the key is still there')
  assert.deepEqual(h.harness.rows(activityLogs), [])
})

test('the first read creates the settings row with the defaults, and answers without an AI service config', async () => {
  const body = await read()
  assert.equal(h.harness.rows(chatbotSettings).length, 1)
  assert.deepEqual([body.settings.enabled, body.settings.mode, body.settings.hasApiKey, body.settings.apiKeyMasked, body.settings.allowedHosts], [false, 'knowledge', false, null, []])
  assert.deepEqual([body.currentProvider, body.currentModel, body.currentSystemPrompt], ['delify', 'delify-5.5', ''])
  await read()
  assert.equal(h.harness.rows(chatbotSettings).length, 1, 'read again, not created again')
})

test('with the chatbot service config and its provider, the AI fields come from them; no key material leaves the server', async () => {
  await storeChatbotKey()
  await h.harness.db.insert(aiProviders).values({ provider: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.example/v1', isActive: true, ...h.storedKey() })
  await h.harness.db.insert(aiServiceConfigs).values({ serviceKey: 'chatbot', serviceName: 'Chatbot', provider: 'openai', model: 'gpt-4o-mini', systemPrompt: 'Lời nhắc mới', isActive: true })
  const body = await read()
  const s = body.settings
  assert.deepEqual([s.model, s.providerPolicy, s.baseUrl, s.allowedHosts, s.enabled, s.hasApiKey, s.apiKeyMasked, s.systemPromptConfigured, s.systemPromptLength],
    ['gpt-4o-mini', 'openai-compatible', 'https://api.openai.example/v1', ['api.openai.example'], true, true, `••••${SECRET.slice(-4)}`, true, 'Lời nhắc mới'.length])
  // Non-AI fields stay those of chatbot_settings.
  assert.deepEqual([s.mode, s.knowledgeGreeting], ['ai', 'Xin chào'])
  assert.deepEqual([body.currentProvider, body.currentModel, body.currentSystemPrompt], ['openai', 'gpt-4o-mini', 'Lời nhắc mới'])
  const text = JSON.stringify(body)
  assert.ok(!containsSecret(text) && !containsSecret(text, CHATBOT_KEY), 'no part of either key')
  for (const field of ['apiKeyCiphertext', 'apiKeyNonce', 'apiKeyAuthTag', 'apiKeyKeyId', 'systemPrompt']) assert.equal(field in s, false, field)

  // An inactive provider switches the chatbot off on the form; anthropic is its own policy.
  h.harness.sqlite.prepare("UPDATE ai_providers SET is_active = 0, provider = 'anthropic'").run()
  h.harness.sqlite.prepare("UPDATE ai_service_configs SET provider = 'anthropic'").run()
  const off = (await read()).settings
  assert.deepEqual([off.enabled, off.providerPolicy], [false, 'anthropic'])
})

test('clear: the stored chatbot key goes with its audit row in one transaction; the answer says no key is stored', async () => {
  await storeChatbotKey()
  h.harness.failNext(/^insert into `activity_logs`/)
  assert.equal((await h.request('POST', '/api/admin/chatbot/settings/clear', superAdmin)).status, 500)
  assert.ok(h.harness.rows(chatbotSettings)[0]!.apiKeyCiphertext, 'a failed audit insert keeps the key')

  const response = await h.request('POST', '/api/admin/chatbot/settings/clear', superAdmin)
  assert.equal(response.status, 200)
  const settings = response.body.settings as Json
  assert.deepEqual([settings.hasApiKey, settings.apiKeyStatus, settings.apiKeyMasked], [false, 'not_configured', null])
  const row = h.harness.rows(chatbotSettings)[0]!
  assert.deepEqual([row.apiKeyCiphertext, row.apiKeyNonce, row.apiKeyAuthTag, row.apiKeyVersion, row.apiKeyKeyId, row.apiKeyLastFour, row.updatedBy],
    [null, null, null, null, null, null, superAdmin.id])
  assert.equal(row.baseUrl, 'https://legacy.example/v1', 'only the key is cleared')
  const audits = h.harness.rows(activityLogs)
  assert.deepEqual(audits.map(a => [a.userId, a.action, a.resource, (a.meta as Json).configured]), [[superAdmin.id, 'clear_key', 'chatbot_settings', false]])
})
