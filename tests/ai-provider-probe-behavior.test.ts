import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { RequestOptions } from 'node:https'
import { PassThrough } from 'node:stream'
import test, { after, beforeEach, mock } from 'node:test'

/**
 * `POST /api/admin/ai/providers/:id/test` (server/api/admin/ai/providers/[id]/test.post.ts)
 * — "test the connection": decrypt the stored API key and send it to the stored
 * base URL. It is the one admin route that ships a stored secret to an address an
 * officer typed, so the invariants are about where the key can go:
 *   - it takes `ai.read`; without it no request leaves the server;
 *   - the destination is checked at CALL time, whatever is stored: `http://`, a
 *     port other than 443, an IP literal, `*.internal`, and a hostname that
 *     RESOLVES to a private / link-local address (DNS rebinding) are all refused
 *     before a byte is sent; the connection is pinned to the address that was
 *     checked, and a redirect is not followed;
 *   - the key goes in the provider's own header (`Authorization: Bearer` for
 *     OpenAI-compatible, `x-api-key` for Anthropic), to `…/models`, and never
 *     appears in the response — not on success, not on failure;
 *   - a key that cannot be decrypted (secret rotated) sends nothing;
 *   - an upstream non-2xx is reported as `HTTP <status>`, not as success.
 *
 * Real h3 app with the real `admin-auth` middleware; Drizzle's SQL on SQLite;
 * real AES-GCM envelope (`encryptAiSecret`); the real `safeProviderRequest`
 * (URL policy, public-address check, pinned lookup, redirect refusal) with only
 * its two network seams replaced — DNS answers and the HTTPS socket.
 */

process.env.JWT_SECRET = 'ai-provider-probe-behavior-test-secret-0123456789'
process.env.CHATBOT_ENCRYPTION_SECRET = Buffer.alloc(32, 7).toString('base64')
const ROTATED_AWAY_SECRET = Buffer.alloc(32, 9).toString('base64')
delete process.env.MFA_ENFORCEMENT

const SECRET = 'sk-live-THIS-KEY-MUST-NEVER-LEAVE-0123456789'

// ─── The network seams: DNS answers and the HTTPS socket ─────────────────────────
type Sent = { hostname: string, path: string, method: string, headers: Record<string, string>, connectTo: string | null }
const network = {
  dns: new Map<string, Array<{ address: string, family: 4 | 6 }>>(),
  sent: [] as Sent[],
  reply: { status: 200, headers: {} as Record<string, string>, body: '{"data":[{"id":"gpt-4o-mini"},{"id":"gpt-4o"}]}' },
}
async function fakeResolve(hostname: string) {
  return network.dns.get(hostname) ?? []
}
function fakeRequest(options: RequestOptions, onResponse: (response: never) => void) {
  const req = Object.assign(new EventEmitter(), {
    write() {},
    destroy() {},
    end() {
      // Where would the socket connect? Ask the pinned lookup the request carries.
      let connectTo: string | null = null
      const lookup = options.lookup as undefined | ((host: string, opts: object, cb: (err: Error | null, address: string | Array<{ address: string }>) => void) => void)
      lookup?.(String(options.hostname), {}, (_err, address) => { connectTo = Array.isArray(address) ? address[0]!.address : address })
      network.sent.push({
        hostname: String(options.hostname),
        path: String(options.path),
        method: String(options.method),
        headers: Object.fromEntries(Object.entries(options.headers ?? {}).map(([key, value]) => [key.toLowerCase(), String(value)])),
        connectTo,
      })
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
    safeProviderRequest: (options: Parameters<typeof realOutbound.safeProviderRequest>[0]) =>
      realOutbound.safeProviderRequest({ ...options, resolveHost: fakeResolve, request: fakeRequest as never }),
  },
})

const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const { roles, permissions, users, settings, userMfaFactors, aiProviders } = await import('../server/db/schema')
const harness = createSqliteMysqlDb([roles, permissions, users, settings, userMfaFactors, aiProviders])

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
const probe = (await import('../server/api/admin/ai/providers/[id]/test.post')).default
const { encryptAiSecret } = await import('../server/utils/ai/crypto')
const { signToken } = await import('../server/utils/auth')
const policy = await import('../server/utils/mfa/policy')

const server = await startHandlerServer([{ method: 'post', path: '/api/admin/ai/providers/:id/test', handler: probe }], [adminAuth])
after(() => server.close())

type Account = { id: number, username: string, roleId: number, roleName: string }
const AI_READER: Account = { id: 4, username: 'xemai', roleId: 3, roleName: 'Xem AI' }
const EDITOR: Account = { id: 5, username: 'bientap', roleId: 4, roleName: 'Biên tập' }
const cookieFor = (account: Account) =>
  `cdkt_admin=${signToken({ userId: account.id, username: account.username, roleId: account.roleId, roleName: account.roleName, tokenVersion: 0 })}`
const testProvider = (id: number | string, account = AI_READER) =>
  server.request('POST', `/api/admin/ai/providers/${id}/test`, { cookie: cookieFor(account) })

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
async function addProvider(id: number, provider: string, baseUrl: string | null, key: ReturnType<typeof storedKey> | null = storedKey()) {
  await harness.db.insert(aiProviders).values({ id, provider, label: provider, baseUrl, isActive: true, ...(key ?? {}) })
}

beforeEach(async () => {
  harness.reset()
  policy.clearMfaPolicyCache()
  policy.clearMfaFactorCache()
  network.sent.length = 0
  network.reply = { status: 200, headers: {}, body: '{"data":[{"id":"gpt-4o-mini"},{"id":"gpt-4o"}]}' }
  network.dns = new Map([
    ['api.openai.example', [{ address: '104.18.6.192', family: 4 }]],
    ['api.anthropic.example', [{ address: '160.79.104.10', family: 4 }]],
    ['rebind.example', [{ address: '169.254.169.254', family: 4 }]],
    ['private.example', [{ address: '104.18.6.192', family: 4 }, { address: '10.0.0.5', family: 4 }]],
    ['v6local.example', [{ address: '::1', family: 6 }]],
  ])
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
})

const leaksSecret = (body: unknown) => JSON.stringify(body).includes(SECRET) || JSON.stringify(body).includes('NEVER-LEAVE')

test('without ai.read no request leaves the server: no session → 401, other resources → 403', async () => {
  await addProvider(1, 'openai', 'https://api.openai.example/v1')
  assert.equal((await server.request('POST', '/api/admin/ai/providers/1/test')).status, 401)
  assert.equal((await testProvider(1, EDITOR)).status, 403)
  assert.deepEqual(network.sent, [])
})

test('OpenAI-compatible: GET …/models with a Bearer key, connected to the address that was checked; the key is not in the answer', async () => {
  await addProvider(1, 'openai', 'https://api.openai.example/v1/')
  const response = await testProvider(1)
  assert.equal(response.status, 200)
  assert.deepEqual(response.body, { ok: true, model: 'gpt-4o-mini' })
  assert.equal(network.sent.length, 1)
  const [sent] = network.sent
  assert.equal(sent!.method, 'GET')
  assert.equal(sent!.hostname, 'api.openai.example')
  assert.equal(sent!.path, '/v1/models')
  assert.equal(sent!.headers.authorization, `Bearer ${SECRET}`)
  assert.equal(sent!.headers['x-api-key'], undefined)
  assert.equal(sent!.connectTo, '104.18.6.192')
  assert.ok(!leaksSecret(response.body))
})

test('Anthropic: the key goes in x-api-key with a version header, never as a Bearer token', async () => {
  await addProvider(2, 'anthropic', 'https://api.anthropic.example')
  network.reply.body = '{"data":[{"id":"claude-sonnet"}]}'
  const response = await testProvider(2)
  assert.deepEqual(response.body, { ok: true, model: 'claude-sonnet' })
  const [sent] = network.sent
  assert.equal(sent!.path, '/v1/models')
  assert.equal(sent!.headers['x-api-key'], SECRET)
  assert.ok(sent!.headers['anthropic-version'])
  assert.equal(sent!.headers.authorization, undefined)
})

test('an unsafe stored destination is refused at call time — nothing is sent, the key is not echoed', async () => {
  const unsafe = [
    'http://api.openai.example/v1',          // not https
    'https://api.openai.example:8443/v1',    // not 443
    'https://169.254.169.254/latest',        // IP literal (cloud metadata)
    'https://[::1]/v1',                      // IPv6 loopback literal
    'https://metadata.google.internal/v1',   // internal name
    'https://localhost/v1',
    'https://rebind.example/v1',             // public name, link-local answer
    'https://private.example/v1',            // one private answer among public ones
    'https://v6local.example/v1',
    'https://nxdomain.example/v1',           // no answer at all
    'https://user:pass@api.openai.example/v1',
  ]
  let id = 10
  for (const baseUrl of unsafe) {
    id += 1
    await addProvider(id, `p${id}`, baseUrl)
    const response = await testProvider(id)
    assert.equal(response.status, 200, baseUrl)
    assert.equal(response.body.ok, false, baseUrl)
    assert.ok(!leaksSecret(response.body), baseUrl)
  }
  assert.deepEqual(network.sent, [], 'no request was sent to any of them')
})

test('a redirect is not followed and a non-2xx is not a success', async () => {
  await addProvider(1, 'openai', 'https://api.openai.example/v1')
  network.reply = { status: 302, headers: { location: 'https://169.254.169.254/' }, body: '' }
  const redirected = await testProvider(1)
  assert.equal(redirected.body.ok, false)
  assert.equal(network.sent.length, 1, 'only the first hop was sent')

  network.reply = { status: 401, headers: {}, body: `{"error":"invalid key ${SECRET}"}` }
  const refused = await testProvider(1)
  assert.deepEqual(refused.body, { ok: false, error: 'HTTP 401' })
  assert.ok(!leaksSecret(refused.body), 'the upstream body (which may echo the key) is not relayed')
})

test('no key, no base URL, an unknown provider or a key that cannot be decrypted: nothing is sent', async () => {
  await addProvider(1, 'nokey', 'https://api.openai.example/v1', null)
  await addProvider(2, 'nourl', null)
  await addProvider(3, 'rotated', 'https://api.openai.example/v1', storedKey(SECRET, ROTATED_AWAY_SECRET))
  for (const id of [1, 2, 3, 99]) {
    const response = await testProvider(id)
    assert.equal(response.status, 200, String(id))
    assert.equal(response.body.ok, false, String(id))
  }
  assert.equal((await testProvider('abc')).status, 400)
  assert.equal((await testProvider(0)).status, 400)
  assert.deepEqual(network.sent, [])
})
