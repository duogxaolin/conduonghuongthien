import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { RequestOptions } from 'node:https'
import { PassThrough } from 'node:stream'
import test, { after, beforeEach, mock } from 'node:test'
import { inspect } from 'node:util'

/**
 * `POST /api/admin/ai/test-call` (server/api/admin/ai/test-call.post.ts) — "call
 * this model now": decrypt a provider's stored API key, send a real chat
 * completion to the provider's stored base URL, record the call in
 * `ai_usage_logs` (which `checkBudget` sums: the row IS the spend) and show the
 * reply. Money, a stored secret and an outbound request in one route.
 *
 * The invariants:
 *   - it takes `ai.read`; without it nothing is sent and nothing is recorded;
 *   - a provider and a model are required; a model or service key the usage log
 *     cannot hold is refused BEFORE the paid call (FINDING-R4-3);
 *   - past the monthly budget nothing is sent;
 *   - the destination is checked at call time (https, 443, public address, no
 *     redirect) — an unsafe stored base URL sends nothing; a provider with no key,
 *     no base URL or a key that no longer decrypts sends nothing;
 *   - the key goes in the provider's own header to the provider's own endpoint
 *     (`…/chat/completions` Bearer, Anthropic `…/v1/messages` + `x-api-key`), and
 *     appears NOWHERE else: not in the answer, not in `ai_usage_logs` (shown in the
 *     AI Logs tab), not in a log line — even when the provider echoes it back
 *     (FINDING-R4-1);
 *   - every call that went out is recorded once, with the tokens the provider
 *     reported and the cost from `ai_model_pricing`; a call that failed is recorded
 *     as failed with a classified reason; a database failure is not reported as a
 *     provider failure and does not happen after the money is spent
 *     (FINDING-R4-2);
 *   - the call has a deadline (20 s) and a response-size cap.
 *
 * Real h3 app with the real `admin-auth` middleware; Drizzle's SQL on SQLite; the
 * real AES-GCM envelope; the real `checkBudget` and `logAiUsage`; the real
 * `safeProviderRequest` (URL policy, public-address check, pinned lookup, redirect
 * refusal, deadline) with only its two network seams replaced — DNS answers and
 * the HTTPS socket. The budget row is seeded > 0 so `checkBudget` never asks
 * Delify for a provider quota (that lookup is its own suite).
 */

process.env.JWT_SECRET = 'ai-test-call-behavior-test-secret-0123456789abc'
process.env.CHATBOT_ENCRYPTION_SECRET = Buffer.alloc(32, 7).toString('base64')
const ROTATED_AWAY_SECRET = Buffer.alloc(32, 9).toString('base64')
delete process.env.MFA_ENFORCEMENT
delete process.env.USD_TO_VND_RATE

const SECRET = 'sk-live-THIS-KEY-MUST-NEVER-LEAVE-0123456789'

// ─── The network seams: DNS answers and the HTTPS socket ─────────────────────────
type Sent = { hostname: string, path: string, method: string, headers: Record<string, string>, connectTo: string | null, body: string }
type Reply = { status: number, headers: Record<string, string>, body: string }
const network = {
  dns: new Map<string, Array<{ address: string, family: 4 | 6 }>>(),
  sent: [] as Sent[],
  /** `'timeout'`: the socket reports a timeout instead of answering. */
  mode: 'answer' as 'answer' | 'timeout',
  reply: { status: 200, headers: {}, body: '' } as Reply,
  /** The limits the handler asked `safeProviderRequest` for. */
  asked: [] as Array<{ timeoutMs?: number, maxResponseBytes?: number }>,
}
async function fakeResolve(hostname: string) {
  return network.dns.get(hostname) ?? []
}
function fakeRequest(options: RequestOptions, onResponse: (response: never) => void) {
  const written: string[] = []
  const req = Object.assign(new EventEmitter(), {
    write(chunk: string | Uint8Array) { written.push(Buffer.from(chunk).toString('utf8')) },
    destroy() {},
    end() {
      let connectTo: string | null = null
      const lookup = options.lookup as undefined | ((host: string, opts: object, cb: (err: Error | null, address: string | Array<{ address: string }>) => void) => void)
      lookup?.(String(options.hostname), {}, (_err, address) => { connectTo = Array.isArray(address) ? address[0]!.address : address })
      network.sent.push({
        hostname: String(options.hostname),
        path: String(options.path),
        method: String(options.method),
        headers: Object.fromEntries(Object.entries(options.headers ?? {}).map(([key, value]) => [key.toLowerCase(), String(value)])),
        connectTo,
        body: written.join(''),
      })
      if (network.mode === 'timeout') {
        queueMicrotask(() => req.emit('timeout'))
        return
      }
      const response = Object.assign(new PassThrough(), { statusCode: network.reply.status, headers: network.reply.headers })
      queueMicrotask(() => {
        onResponse(response as never)
        response.end(Buffer.from(network.reply.body))
      })
    },
  })
  return req
}

const realOutbound = await import('../server/utils/chatbot/outbound')
mock.module('../server/utils/chatbot/outbound', {
  namedExports: {
    ...realOutbound,
    safeProviderRequest: (options: Parameters<typeof realOutbound.safeProviderRequest>[0]) => {
      network.asked.push({ timeoutMs: options.timeoutMs, maxResponseBytes: options.maxResponseBytes })
      return realOutbound.safeProviderRequest({ ...options, resolveHost: fakeResolve, request: fakeRequest as never })
    },
  },
})

const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const { roles, permissions, users, settings, userMfaFactors, aiProviders, aiModelPricing, aiUsageLogs, aiBudgetSettings, aiServiceConfigs } = await import('../server/db/schema')
const harness = createSqliteMysqlDb([roles, permissions, users, settings, userMfaFactors, aiProviders, aiModelPricing, aiUsageLogs, aiBudgetSettings, aiServiceConfigs])

/** Every logger call, rendered with `inspect` (an Error's message and cause included). */
const logged: string[] = []
const record = (level: string) => (entry: unknown) => { logged.push(`${level} ${inspect(entry, { depth: 8 })}`) }
mock.module('../server/utils/logger', {
  namedExports: {
    log: record('log'),
    logInfo: record('info'),
    logWarn: record('warn'),
    logError: record('error'),
    SECURITY_EVENTS: new Proxy({}, { get: (_target, key) => `event.${String(key)}` }),
  },
})
mock.module('../server/utils/db', { namedExports: { getDb: () => harness.db, getPool: () => null } })

const { installH3Globals, startHandlerServer } = await import('./_h3-handler-server')
installH3Globals()
const adminAuth = (await import('../server/middleware/admin-auth')).default
const testCall = (await import('../server/api/admin/ai/test-call.post')).default
const { encryptAiSecret } = await import('../server/utils/ai/crypto')
const { signToken } = await import('../server/utils/auth')
const policy = await import('../server/utils/mfa/policy')

const server = await startHandlerServer([{ method: 'post', path: '/api/admin/ai/test-call', handler: testCall }], [adminAuth])
after(() => server.close())

type Account = { id: number, username: string, roleId: number, roleName: string }
const AI_READER: Account = { id: 4, username: 'xemai', roleId: 3, roleName: 'Xem AI' }
const EDITOR: Account = { id: 5, username: 'bientap', roleId: 4, roleName: 'Biên tập' }
const cookieFor = (account: Account) =>
  `cdkt_admin=${signToken({ userId: account.id, username: account.username, roleId: account.roleId, roleName: account.roleName, tokenVersion: 0 })}`
const call = (body: unknown, account = AI_READER) =>
  server.request('POST', '/api/admin/ai/test-call', { cookie: cookieFor(account), body })

function storedKey(secret = SECRET, encryptionSecret?: string) {
  const envelope = encryptAiSecret(secret, encryptionSecret)
  return {
    apiKeyCiphertext: envelope.ciphertext,
    apiKeyNonce: envelope.nonce,
    apiKeyAuthTag: envelope.authTag,
    apiKeyVersion: envelope.version,
    apiKeyKeyId: envelope.keyId,
    apiKeyLastFour: secret.slice(-4),
  }
}
async function addProvider(provider: string, baseUrl: string | null, key: ReturnType<typeof storedKey> | null = storedKey()) {
  await harness.db.insert(aiProviders).values({ provider, label: `Nhãn ${provider}`, baseUrl, isActive: true, ...(key ?? {}) })
}

const openAiReply = (content: string, usage?: Record<string, number>) =>
  JSON.stringify({ id: 'cmpl-1', choices: [{ index: 0, message: { role: 'assistant', content } }], ...(usage ? { usage } : {}) })

beforeEach(async () => {
  harness.reset()
  policy.clearMfaPolicyCache()
  policy.clearMfaFactorCache()
  network.sent.length = 0
  network.asked.length = 0
  network.mode = 'answer'
  network.reply = { status: 200, headers: { 'content-type': 'application/json' }, body: openAiReply('Xin chào, tôi là trợ lý.', { prompt_tokens: 1000, completion_tokens: 2000 }) }
  network.dns = new Map([
    ['api.openai.example', [{ address: '104.18.6.192', family: 4 }]],
    ['api.anthropic.example', [{ address: '160.79.104.10', family: 4 }]],
    ['router.delify.example', [{ address: '172.67.1.10', family: 4 }]],
    ['rebind.example', [{ address: '169.254.169.254', family: 4 }]],
  ])
  logged.length = 0
  await harness.db.insert(roles).values([
    { id: AI_READER.roleId, name: AI_READER.roleName, isSystem: false },
    { id: EDITOR.roleId, name: EDITOR.roleName, isSystem: false },
  ])
  await harness.db.insert(permissions).values([
    { roleId: AI_READER.roleId, resource: 'ai', canRead: true },
    { roleId: EDITOR.roleId, resource: 'news', canRead: true, canCreate: true, canUpdate: true, canDelete: true },
  ])
  await harness.db.insert(users).values([AI_READER, EDITOR].map(account => ({
    id: account.id, username: account.username, email: `${account.username}@example.vn`, passwordHash: 'x', roleId: account.roleId,
  })))
  await harness.db.insert(aiBudgetSettings).values({ id: 1, monthlyBudgetVnd: 1_000_000, warningThresholdPct: 80 })
  await harness.db.insert(aiServiceConfigs).values({ serviceKey: 'translation_article', serviceName: 'Dịch bài viết', provider: 'openai', model: 'gpt-4o-mini' })
  await harness.db.insert(aiModelPricing).values({ model: 'gpt-4o-mini', provider: 'openai', promptCostPerMillion: '0.15', completionCostPerMillion: '0.6' })
  await addProvider('openai', 'https://api.openai.example/v1/')
})

/** Every 8-character window of the key: a partial echo counts as a leak too. */
function containsSecret(text: string): boolean {
  for (let start = 0; start + 8 <= SECRET.length; start += 1) {
    if (text.includes(SECRET.slice(start, start + 8))) return true
  }
  return false
}
function assertKeyNowhere(responseBody: unknown, label = '') {
  assert.ok(!containsSecret(JSON.stringify(responseBody)), `response ${label}`)
  for (const row of harness.rows(aiUsageLogs)) assert.ok(!containsSecret(JSON.stringify(row)), `ai_usage_logs ${label}`)
  for (const line of logged) assert.ok(!containsSecret(line), `log line ${label}: ${line.slice(0, 200)}`)
}
const usage = () => harness.rows(aiUsageLogs).map(row => ({
  serviceKey: row.serviceKey, provider: row.provider, model: row.model, promptTokens: row.promptTokens, completionTokens: row.completionTokens,
  totalTokens: row.totalTokens, costVnd: Number(row.costVnd), userId: row.userId, success: row.success, errorMessage: row.errorMessage,
}))

test('without ai.read nothing is sent and nothing is recorded: no session → 401, other resources → 403', async () => {
  assert.equal((await server.request('POST', '/api/admin/ai/test-call', { body: { provider: 'openai', model: 'gpt-4o-mini' } })).status, 401)
  assert.equal((await call({ provider: 'openai', model: 'gpt-4o-mini' }, EDITOR)).status, 403)
  assert.deepEqual(network.sent, [])
  assert.deepEqual(usage(), [])
})

test('a provider and a model are required — 400, nothing sent', async () => {
  for (const body of [{}, { model: 'gpt-4o-mini' }, { provider: '  ', model: 'gpt-4o-mini' }, { provider: 'openai' }, { provider: 'openai', model: 42 }]) {
    const response = await call(body)
    assert.equal(response.status, 400, JSON.stringify(body))
  }
  assert.deepEqual(network.sent, [])
  assert.deepEqual(usage(), [])
})

test('OpenAI-compatible: one POST to …/chat/completions with a Bearer key, recorded with the provider\'s tokens and the priced cost', async () => {
  const response = await call({ provider: 'openai', model: 'gpt-4o-mini', systemPrompt: '  Bạn là trợ lý.  ', message: 'Chào bạn', temperature: 9, maxTokens: 5000 })
  assert.equal(response.status, 200)
  assert.equal(response.body.ok, true)
  assert.equal(response.body.reply, 'Xin chào, tôi là trợ lý.')
  assert.deepEqual(response.body.usage, { promptTokens: 1000, completionTokens: 2000, totalTokens: 3000 })
  // (1000 × 0.15 + 2000 × 0.6) / 1e6 USD × 25 500 VND
  assert.ok(Math.abs(Number(response.body.costVnd) - 34.425) < 1e-9, String(response.body.costVnd))

  assert.equal(network.sent.length, 1)
  const [sent] = network.sent
  assert.equal(sent!.method, 'POST')
  assert.equal(sent!.hostname, 'api.openai.example')
  assert.equal(sent!.path, '/v1/chat/completions')
  assert.equal(sent!.connectTo, '104.18.6.192')
  assert.equal(sent!.headers.authorization, `Bearer ${SECRET}`)
  assert.equal(sent!.headers['x-api-key'], undefined)
  assert.deepEqual(JSON.parse(sent!.body), {
    model: 'gpt-4o-mini',
    messages: [{ role: 'system', content: 'Bạn là trợ lý.' }, { role: 'user', content: 'Chào bạn' }],
    temperature: 2, // clamped to 0–2
    max_tokens: 1024, // clamped to 1–1024
    stream: false,
  })

  assert.deepEqual(usage(), [{
    serviceKey: 'test_call', provider: 'openai', model: 'gpt-4o-mini', promptTokens: 1000, completionTokens: 2000, totalTokens: 3000,
    costVnd: 34.43, userId: AI_READER.id, success: true, errorMessage: null,
  }])
  assertKeyNowhere(response.body)
})

test('the endpoint path follows the stored base URL; a default greeting and limits are used when the body has none', async () => {
  harness.sqlite.prepare('DELETE FROM ai_providers').run()
  await addProvider('openai', 'https://api.openai.example/v1/chat/completions')
  await addProvider('bare', 'https://api.openai.example')
  assert.equal((await call({ provider: 'openai', model: 'gpt-4o-mini' })).body.ok, true)
  assert.equal((await call({ provider: 'bare', model: 'gpt-4o-mini', temperature: 'hot', maxTokens: Number.NaN })).body.ok, true)
  assert.deepEqual(network.sent.map(sent => sent.path), ['/v1/chat/completions', '/v1/chat/completions'])
  const second = JSON.parse(network.sent[1]!.body)
  assert.deepEqual(second.messages, [{ role: 'user', content: 'Xin chào! Bạn là ai?' }])
  assert.equal(second.temperature, 0.3)
  assert.equal(second.max_tokens, 150)
})

test('Anthropic: the key goes in x-api-key with a version header to …/v1/messages, never as a Bearer token', async () => {
  await addProvider('anthropic', 'https://api.anthropic.example')
  network.reply.body = JSON.stringify({ content: [{ type: 'text', text: 'Tôi là Claude.' }], usage: { input_tokens: 12, output_tokens: 7 } })
  const response = await call({ provider: 'anthropic', model: 'claude-sonnet', systemPrompt: 'Hệ thống', message: 'Bạn là ai?' })
  assert.equal(response.body.ok, true)
  assert.equal(response.body.reply, 'Tôi là Claude.')
  assert.deepEqual(response.body.usage, { promptTokens: 12, completionTokens: 7, totalTokens: 19 })
  const [sent] = network.sent
  assert.equal(sent!.path, '/v1/messages')
  assert.equal(sent!.headers['x-api-key'], SECRET)
  assert.equal(sent!.headers['anthropic-version'], '2023-06-01')
  assert.equal(sent!.headers.authorization, undefined)
  const payload = JSON.parse(sent!.body)
  assert.equal(payload.system, 'Hệ thống')
  assert.deepEqual(payload.messages, [{ role: 'user', content: 'Bạn là ai?' }])
  // No pricing row for this model: the call is recorded, at zero cost.
  assert.equal(response.body.costVnd, 0)
  assert.equal(usage()[0]!.success, true)
  assertKeyNowhere(response.body)
})

test('token accounting: Delify\'s 2000-token prompt offset is removed; no usage in the answer → an estimate, never 0', async () => {
  await addProvider('delify', 'https://router.delify.example/v1')
  network.reply.body = openAiReply('ok', { prompt_tokens: 2500, completion_tokens: 40 })
  assert.deepEqual((await call({ provider: 'delify', model: 'delify-5.5' })).body.usage, { promptTokens: 500, completionTokens: 40, totalTokens: 540 })
  network.reply.body = openAiReply('ok', { prompt_tokens: 1999, completion_tokens: 40 })
  assert.deepEqual((await call({ provider: 'delify', model: 'delify-5.5' })).body.usage, { promptTokens: 1999, completionTokens: 40, totalTokens: 2039 })
  // The same count from another provider is taken as reported.
  network.reply.body = openAiReply('ok', { prompt_tokens: 2500, completion_tokens: 40 })
  assert.deepEqual((await call({ provider: 'openai', model: 'gpt-4o-mini' })).body.usage, { promptTokens: 2500, completionTokens: 40, totalTokens: 2540 })
  assert.deepEqual(usage().map(row => row.promptTokens), [500, 1999, 2500])

  network.reply.body = openAiReply('1234567')
  const estimated = await call({ provider: 'openai', model: 'gpt-4o-mini', message: 'abcdefghij' })
  assert.deepEqual(estimated.body.usage, { promptTokens: 3, completionTokens: 2, totalTokens: 5 })

  network.reply.body = JSON.stringify({ choices: [] })
  const empty = await call({ provider: 'openai', model: 'gpt-4o-mini' })
  assert.equal(empty.body.ok, true)
  assert.match(String(empty.body.reply), /không có nội dung chữ/)
})

test('past the monthly budget nothing is sent and nothing is recorded', async () => {
  await harness.db.insert(aiUsageLogs).values({ serviceKey: 'chatbot', provider: 'openai', model: 'gpt-4o-mini', costUsd: '40', costVnd: '1000000' })
  const before = usage()
  const response = await call({ provider: 'openai', model: 'gpt-4o-mini' })
  assert.equal(response.status, 200)
  assert.equal(response.body.ok, false)
  assert.match(String(response.body.error), /hết ngân sách/)
  assert.deepEqual(network.sent, [])
  assert.deepEqual(usage(), before)
})

test('an unknown provider, no key, no base URL or a key that no longer decrypts: nothing is sent or recorded', async () => {
  await addProvider('nokey', 'https://api.openai.example/v1', null)
  await addProvider('nourl', null)
  await addProvider('rotated', 'https://api.openai.example/v1', storedKey(SECRET, ROTATED_AWAY_SECRET))
  for (const provider of ['missing', 'nokey', 'nourl', 'rotated']) {
    const response = await call({ provider, model: 'gpt-4o-mini' })
    assert.equal(response.status, 200, provider)
    assert.equal(response.body.ok, false, provider)
    assertKeyNowhere(response.body, provider)
  }
  assert.deepEqual(network.sent, [])
  assert.deepEqual(usage(), [])
})

test('an unsafe stored destination is refused at call time — nothing is sent, the failure is recorded with a classified reason', async () => {
  const unsafe = ['http://api.openai.example/v1', 'https://api.openai.example:8443/v1', 'https://169.254.169.254/v1', 'https://metadata.google.internal/v1', 'https://rebind.example/v1', 'https://nxdomain.example/v1']
  for (const [index, baseUrl] of unsafe.entries()) {
    await addProvider(`p${index}`, baseUrl)
    const response = await call({ provider: `p${index}`, model: 'gpt-4o-mini' })
    assert.equal(response.status, 200, baseUrl)
    assert.equal(response.body.ok, false, baseUrl)
    assert.match(String(response.body.error), /^Thất bại khi gọi API: Provider (configuration is invalid|destination)/, baseUrl)
    assertKeyNowhere(response.body, baseUrl)
  }
  assert.deepEqual(network.sent, [], 'no request was sent to any of them')
  assert.equal(usage().length, unsafe.length)
  assert.ok(usage().every(row => row.success === false && row.costVnd === 0))
})

test('a redirect is not followed; the call has a 20 s deadline and a 128 KiB cap, and a timeout is a classified failure', async () => {
  network.reply = { status: 302, headers: { location: 'https://169.254.169.254/' }, body: '' }
  const redirected = await call({ provider: 'openai', model: 'gpt-4o-mini' })
  assert.equal(redirected.body.ok, false)
  assert.equal(redirected.body.error, 'Thất bại khi gọi API: Provider redirect was rejected.')
  assert.equal(network.sent.length, 1, 'only the first hop was sent')

  network.mode = 'timeout'
  const timedOut = await call({ provider: 'openai', model: 'gpt-4o-mini' })
  assert.equal(timedOut.body.ok, false)
  assert.equal(timedOut.body.error, 'Thất bại khi gọi API: Provider request timed out.')
  assert.deepEqual(network.asked, [{ timeoutMs: 20_000, maxResponseBytes: 131_072 }, { timeoutMs: 20_000, maxResponseBytes: 131_072 }])
  assert.deepEqual(usage().map(row => [row.success, row.errorMessage]), [
    [false, 'Provider redirect was rejected.'],
    [false, 'Provider request timed out.'],
  ])
})

test('an upstream error is a failure: reported and recorded with its status, not as a success', async () => {
  network.reply = { status: 404, headers: {}, body: '{"error":{"message":"The model `gpt-9` does not exist"}}' }
  const response = await call({ provider: 'openai', model: 'gpt-9', serviceKey: 'translation_article' })
  assert.equal(response.body.ok, false)
  assert.match(String(response.body.error), /^HTTP 404: .*does not exist/)
  assert.deepEqual(usage().map(row => [row.serviceKey, row.success, row.costVnd]), [['translation_article', false, 0]])
  assert.match(String(usage()[0]!.errorMessage), /^HTTP 404/)
})

/**
 * FINDING-R4-1 — severity medium. The route relays the provider's error body
 * (first 300 characters) into the answer AND stores it in
 * `ai_usage_logs.error_message`, shown in the AI Logs tab to every `ai.read`
 * holder. Providers and proxies echo the credential they rejected ("Incorrect API
 * key provided: sk-…"), so the stored key — which `ai.read` never otherwise
 * reveals — came back verbatim. The connection probe
 * (`providers/[id]/test.post.ts`) already refuses to relay the body for this
 * reason (`ai-provider-probe-behavior`). A 2xx body that is not JSON leaked a
 * fragment the same way: V8's `SyntaxError` quotes the start of the text.
 * The key here straddles character 300, so redacting AFTER the cut leaves a
 * prefix of it behind.
 */
test('FINDING-R4-1: a provider that echoes the key does not get it into the answer, the usage log or a log line', async () => {
  // 250 + 29 characters before the key: it spans characters 279–322 of the body.
  network.reply = { status: 401, headers: {}, body: `${'x'.repeat(250)} Incorrect API key provided: ${SECRET}. Find your key at the dashboard.` }
  const rejected = await call({ provider: 'openai', model: 'gpt-4o-mini' })
  assert.equal(rejected.body.ok, false)
  assert.match(String(rejected.body.error), /^HTTP 401: x{250} Incorrect API key provided: \[đã ẩn khoá API\]/, 'the provider\'s words stay, only the key goes')
  assertKeyNowhere(rejected.body, '401 echo')

  network.reply = { status: 200, headers: {}, body: `${SECRET} is not a JSON answer` }
  const garbled = await call({ provider: 'openai', model: 'gpt-4o-mini' })
  assert.equal(garbled.body.error, 'Thất bại khi gọi API: Phản hồi của nhà cung cấp không phải JSON hợp lệ.')
  assertKeyNowhere(garbled.body, 'non-JSON 2xx')

  network.reply = { status: 200, headers: {}, body: openAiReply(`Khoá của bạn là ${SECRET}`) }
  const echoedReply = await call({ provider: 'openai', model: 'gpt-4o-mini' })
  assert.equal(echoedReply.body.ok, true)
  assertKeyNowhere(echoedReply.body, 'reply echo')
  assert.equal(network.sent.length, 3)
})

/**
 * FINDING-R4-2 — severity low. The pricing lookup ran AFTER the paid call, inside
 * the try that maps every error to "Thất bại khi gọi API: <message>": a database
 * failure there sent Drizzle's "Failed query: select … from ai_model_pricing …"
 * text to the client, and recorded a call that succeeded (and cost money) as
 * failed, at zero cost — spend `checkBudget` never sees.
 */
test('FINDING-R4-2: a database failure is not a provider failure and does not come after the money is spent', async () => {
  harness.failNext(/from `ai_model_pricing`/)
  const response = await call({ provider: 'openai', model: 'gpt-4o-mini' })
  assert.equal(response.status, 500)
  assert.deepEqual(network.sent, [], 'nothing was sent: the lookup failed before the call')
  assert.deepEqual(usage(), [])

  network.reply = { status: 200, headers: {}, body: 'null' }
  const nullAnswer = await call({ provider: 'openai', model: 'gpt-4o-mini' })
  assert.equal(nullAnswer.body.ok, false)
  assert.doesNotMatch(String(nullAnswer.body.error), /Cannot|null|undefined|property|operator/i, 'no JavaScript error text')
})

/**
 * FINDING-R4-3 — severity medium. `serviceKey` and `model` were taken as sent,
 * any length, but `ai_usage_logs.service_key` / `model` are VARCHAR(64). Under
 * MySQL's strict sql_mode (the default, and what the dev container runs) the
 * insert fails, `logAiUsage` swallows the error by design — and a call that was
 * sent and paid for never reaches the table `checkBudget` sums. Any `ai.read`
 * holder could spend without limit. The service key is also an attribution the
 * client chose: only `test_call` and the configured services are real ones.
 */
test('FINDING-R4-3: a service key or model the usage log cannot hold is refused before the paid call', async () => {
  for (const body of [
    { provider: 'openai', model: 'gpt-4o-mini', serviceKey: 'k'.repeat(65) },
    { provider: 'openai', model: 'gpt-4o-mini', serviceKey: 'no_such_service' },
    { provider: 'openai', model: 'm'.repeat(65) },
  ]) {
    const response = await call(body)
    assert.equal(response.status, 400, JSON.stringify(body).slice(0, 80))
  }
  assert.deepEqual(network.sent, [])
  assert.deepEqual(usage(), [])

  // The two keys the admin pages send are accepted and recorded as sent.
  assert.equal((await call({ provider: 'openai', model: 'gpt-4o-mini', serviceKey: 'test_call' })).body.ok, true)
  assert.equal((await call({ provider: 'openai', model: 'gpt-4o-mini', serviceKey: ' translation_article ' })).body.ok, true)
  assert.deepEqual(usage().map(row => row.serviceKey), ['test_call', 'translation_article'])
})
