import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

/**
 * Kiểm lúc GHI địa chỉ nhà cung cấp AI — chạy ba handler thật với DB giả:
 *   - POST /api/admin/ai/providers và PUT /api/admin/ai/providers/:id từ chối địa
 *     chỉ ngoài chính sách (400, lời tiếng Việt) và không ghi gì;
 *   - PUT đổi Base URL của nhà cung cấp đang giữ khoá phải kèm khoá mới;
 *   - PATCH cấu hình chatbot: đổi baseUrl/allowedHosts đòi siêu quản trị, như xoay khoá.
 */

type Row = Record<string, unknown>
const writes: Array<{ op: string, table: string, values: Row }> = []
let providerRow: Row | null = null
let chatbotRow: Row = {}

const schema = await import('../server/db/schema')
const tableName = (table: unknown) => {
  if (table === schema.aiProviders) return 'ai_providers'
  if (table === schema.activityLogs) return 'activity_logs'
  if (table === schema.chatbotSettings) return 'chatbot_settings'
  if (table === schema.aiServiceConfigs) return 'ai_service_configs'
  return 'other'
}
const rowsFor = (table: unknown): Row[] => {
  if (table === schema.aiProviders) return providerRow ? [providerRow] : []
  if (table === schema.chatbotSettings) return [chatbotRow]
  return []
}
const tx = {
  insert: (table: unknown) => ({ values: async (values: Row) => { writes.push({ op: 'insert', table: tableName(table), values }); return [{ insertId: 77 }] } }),
  update: (table: unknown) => ({ set: (values: Row) => ({ where: async () => { writes.push({ op: 'update', table: tableName(table), values }) } }) }),
}
mock.module('../server/utils/db', {
  namedExports: {
    getDb: () => ({
      ...tx,
      select: () => ({ from: (table: unknown) => ({ where: () => ({ limit: async () => rowsFor(table) }) }) }),
      transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    }),
  },
})
mock.module('../server/utils/ai/crypto', {
  namedExports: {
    encryptAiSecret: (plain: string) => ({ ciphertext: `enc(${plain})`, nonce: 'n', authTag: 't', version: 1, keyId: 'k', lastFour: plain.slice(-4) }),
  },
})

type Event = { body: unknown, params: Record<string, string>, context: { adminUser: unknown, requestId?: string } }
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.readBody = async (event: Event) => event.body
globals.getRouterParam = (event: Event, name: string) => event.params[name]
globals.createError = (input: { statusCode: number, statusMessage: string }) => Object.assign(new Error(input.statusMessage), input)

const createProvider = (await import('../server/api/admin/ai/providers/index.post')).default as unknown as (event: Event) => Promise<Row>
const updateProvider = (await import('../server/api/admin/ai/providers/[id].put')).default as unknown as (event: Event) => Promise<Row>
const patchChatbot = (await import('../server/api/admin/chatbot/settings/index.patch')).default as unknown as (event: Event) => Promise<Row>

const aiEditor = { id: 5, isSuperAdmin: false, permissions: [{ resource: 'ai', canCreate: true, canRead: true, canUpdate: true, canDelete: false }] }
const chatbotEditor = { id: 6, isSuperAdmin: false, permissions: [{ resource: 'chatbot_settings', canCreate: false, canRead: true, canUpdate: true, canDelete: false }] }
const superAdmin = { id: 1, isSuperAdmin: true, permissions: [] }
const event = (adminUser: unknown, body: unknown, id = '3'): Event => ({ body, params: { id }, context: { adminUser, requestId: 'req-1' } })

function reset() {
  writes.length = 0
  providerRow = null
  chatbotRow = { id: 1, baseUrl: 'https://api.provider.example/v1', allowedHosts: ['api.provider.example'], providerPolicy: 'openai-compatible', enabled: false }
}
async function failure(run: () => Promise<unknown>): Promise<{ status: number, message: string } | null> {
  try { await run(); return null } catch (error) {
    const e = error as { statusCode?: number, statusMessage?: string, message?: string }
    return { status: e.statusCode ?? -1, message: e.statusMessage ?? e.message ?? '' }
  }
}

const BAD = [
  'http://api.provider.example/v1',
  'https://user:pw@api.provider.example/v1',
  'https://api.provider.example:8443/v1',
  'https://127.0.0.1/v1',
  'https://10.0.0.1/v1',
  'https://169.254.169.254/latest/meta-data',
  'https://[::1]/v1',
  'https://2130706433/v1',
  'https://0x7f000001/v1',
  'https://localhost/v1',
  'https://LocalHost./v1',
  'https://metadata.google.internal/v1',
  'https://nas.local/v1',
  'https://mysql/v1',
  'https://api.provider.example/v1?k=1',
  'javascript:alert(1)',
]

// ─── POST /api/admin/ai/providers ─────────────────────────────────────────────

test('create: a base URL outside the policy is refused with a Vietnamese reason and nothing is written', async () => {
  for (const baseUrl of BAD) {
    reset()
    const result = await failure(() => createProvider(event(aiEditor, { provider: 'x', label: 'X', baseUrl, apiKey: 'sk-1234' })))
    assert.equal(result?.status, 400, baseUrl)
    assert.match(result!.message, /Địa chỉ nhà cung cấp/, baseUrl)
    assert.deepEqual(writes, [], `${baseUrl}: nothing written`)
  }
})

test('create: a valid base URL is stored in its normalized form, with its audit row', async () => {
  reset()
  await createProvider(event(aiEditor, { provider: 'x', label: 'X', baseUrl: ' https://API.Provider.Example/v1/ ', apiKey: 'sk-1234' }))
  const insert = writes.find(w => w.table === 'ai_providers')!
  assert.equal(insert.values.baseUrl, 'https://api.provider.example/v1')
  assert.ok(writes.some(w => w.table === 'activity_logs'))
})

test('create: an empty base URL is still allowed (provider configured later)', async () => {
  reset()
  await createProvider(event(aiEditor, { provider: 'x', label: 'X', baseUrl: '' }))
  assert.equal(writes.find(w => w.table === 'ai_providers')!.values.baseUrl, null)
})

// ─── PUT /api/admin/ai/providers/:id ──────────────────────────────────────────

const storedProvider = (withKey: boolean) => ({
  id: 3, provider: 'delify', label: 'Delify', baseUrl: 'https://router.delify.vn/v1', isActive: true,
  apiKeyCiphertext: withKey ? 'old-cipher' : null,
})

test('update: a base URL outside the policy is refused and nothing is written', async () => {
  for (const baseUrl of BAD) {
    reset()
    providerRow = storedProvider(true)
    const result = await failure(() => updateProvider(event(aiEditor, { baseUrl, apiKey: 'sk-new-key' })))
    assert.equal(result?.status, 400, baseUrl)
    assert.match(result!.message, /Địa chỉ nhà cung cấp/, baseUrl)
    assert.deepEqual(writes, [], `${baseUrl}: nothing written`)
  }
})

test('update: moving a provider that holds a key to a new address requires re-entering the key', async () => {
  reset()
  providerRow = storedProvider(true)
  const refused = await failure(() => updateProvider(event(aiEditor, { baseUrl: 'https://attacker.example/v1', apiKey: null })))
  assert.equal(refused?.status, 400)
  assert.match(refused!.message, /nhập lại API key/)
  assert.deepEqual(writes, [])

  reset()
  providerRow = storedProvider(true)
  await updateProvider(event(aiEditor, { baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-fresh-1234' }))
  const update = writes.find(w => w.table === 'ai_providers')!
  assert.equal(update.values.baseUrl, 'https://api.openai.com/v1')
  assert.equal(update.values.apiKeyCiphertext, 'enc(sk-fresh-1234)', 'the new key is stored with the new address')
})

test('update: re-sending the same address (any spelling) needs no key — the admin page always sends it', async () => {
  for (const same of ['https://router.delify.vn/v1', 'https://ROUTER.delify.vn/v1/', ' https://router.delify.vn/v1 ']) {
    reset()
    providerRow = storedProvider(true)
    await updateProvider(event(aiEditor, { baseUrl: same, label: 'Đổi nhãn', apiKey: null }))
    const update = writes.find(w => w.table === 'ai_providers')!
    assert.equal(update.values.label, 'Đổi nhãn', same)
    assert.ok(!('apiKeyCiphertext' in update.values), `${same}: the stored key is untouched`)
  }
})

test('update: a provider with no stored key can change address without one; clearing the address needs none', async () => {
  reset()
  providerRow = storedProvider(false)
  await updateProvider(event(aiEditor, { baseUrl: 'https://api.deepseek.com/v1' }))
  assert.equal(writes.find(w => w.table === 'ai_providers')!.values.baseUrl, 'https://api.deepseek.com/v1')

  reset()
  providerRow = storedProvider(true)
  await updateProvider(event(aiEditor, { baseUrl: '' }))
  assert.equal(writes.find(w => w.table === 'ai_providers')!.values.baseUrl, null)
})

test('update: a legacy row holding a bad address can still be relabelled or switched off', async () => {
  reset()
  providerRow = { ...storedProvider(true), baseUrl: 'http://10.0.0.5:8080/v1' }
  await updateProvider(event(aiEditor, { baseUrl: 'http://10.0.0.5:8080/v1', isActive: false }))
  const update = writes.find(w => w.table === 'ai_providers')!
  assert.equal(update.values.isActive, false)
  assert.ok(!('baseUrl' in update.values), 'the untouched address is not rewritten')
})

// ─── PATCH /api/admin/chatbot/settings ───────────────────────────────────────

test('chatbot settings: changing the destination needs a super admin, like rotating the key', async () => {
  const changes: Row[] = [
    { baseUrl: 'https://attacker.example/v1', allowedHosts: ['attacker.example'] },
    { baseUrl: 'https://other.provider.example/v1' },
    { allowedHosts: ['api.provider.example', 'attacker.example'] },
  ]
  for (const body of changes) {
    reset()
    const refused = await failure(() => patchChatbot(event(chatbotEditor, body)))
    assert.equal(refused?.status, 403, JSON.stringify(body))
    assert.match(refused!.message, /siêu quản trị/)
    assert.deepEqual(writes, [], `${JSON.stringify(body)}: nothing written`)
  }

  reset()
  await patchChatbot(event(superAdmin, { baseUrl: 'https://other.provider.example/v1', allowedHosts: ['other.provider.example'] }))
  const update = writes.find(w => w.table === 'chatbot_settings')!
  assert.equal(update.values.baseUrl, 'https://other.provider.example/v1')
})

test('chatbot settings: re-sending the stored destination is not a change; ordinary edits still work', async () => {
  reset()
  await patchChatbot(event(chatbotEditor, { baseUrl: 'https://API.provider.example/v1/', allowedHosts: ['API.provider.example.'], enabled: true }))
  assert.equal(writes.find(w => w.table === 'chatbot_settings')!.values.enabled, true)

  reset()
  await patchChatbot(event(chatbotEditor, { enabled: true }))
  assert.ok(writes.some(w => w.table === 'chatbot_settings'))
})

test('chatbot settings: even a super admin cannot set a destination outside the policy', async () => {
  for (const baseUrl of ['http://api.provider.example/v1', 'https://127.0.0.1/v1', 'https://localhost/v1', 'https://api.provider.example:8443/v1']) {
    reset()
    const refused = await failure(() => patchChatbot(event(superAdmin, { baseUrl, allowedHosts: [new URL(baseUrl).hostname] })))
    assert.equal(refused?.status, 400, baseUrl)
    assert.deepEqual(writes, [], baseUrl)
  }
  reset()
  const refused = await failure(() => patchChatbot(event(superAdmin, { allowedHosts: ['localhost'] })))
  assert.equal(refused?.status, 400)
})
