import assert from 'node:assert/strict'
import test, { beforeEach, mock } from 'node:test'

/**
 * Three consumers of the client's address, each of which must use the RESOLVED address
 * (`getClientIp`: the forwarded chain is believed only from a proxy we listed) and never
 * the raw `x-forwarded-for` header or the raw socket peer:
 *
 *   - the chat rate-limit bucket (`clientKey` in `chat-policy-rate-limit.ts`);
 *   - the `ip` stored in the audit row of an admin logout;
 *   - the proxy-trust decision behind the OAuth redirect URI (`google-oauth/config.ts`).
 *
 * `client-ip.test.ts` kept these as regexes over source text (`getClientIp(event)` present,
 * `xForwardedFor` / `getRequestHeader(event, 'x-forwarded-for')` absent, `isTrustedProxy(` +
 * `xForwardedFor: false`). The pure resolver there is already tested by running it; what was
 * never run is whether those three call sites feed it. Here they run for real, on events
 * whose peer is a stranger sending a forged `x-forwarded-for`, and on events whose peer is
 * the listed proxy (loopback is always trusted).
 */

const STRANGER = '203.0.113.9' // a client that reached the app directly, not through nginx
const FORGED = '198.51.100.77' // what that client claims in `x-forwarded-for`
const REAL_VISITOR = '192.0.2.44' // what nginx appends for a genuine visitor

const hits: string[] = []
const auditRows: Array<Record<string, unknown>> = []

const realStore = await import('../server/utils/rate-limit-store')
mock.module('../server/utils/rate-limit-store', {
  namedExports: {
    ...realStore,
    recordRateLimitHit: (key: string, ...rest: [never, never]) => { hits.push(key); return realStore.recordRateLimitHit(key, ...rest) },
  },
})
mock.module('../server/utils/db', {
  namedExports: {
    getPool: () => null,
    getDb: () => ({
      update: () => ({ set: () => ({ where: async () => undefined }) }),
      insert: () => ({ values: async (values: Record<string, unknown>) => { auditRows.push(values) } }),
    }),
  },
})

const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.deleteCookie = () => undefined

type FakeEvent = { node: { req: { headers: Record<string, string>, socket: { remoteAddress: string } } }, context: Record<string, unknown> }
function eventFrom(peer: string, headers: Record<string, string> = {}, context: Record<string, unknown> = {}): FakeEvent {
  return { node: { req: { headers, socket: { remoteAddress: peer } } }, context }
}

const logout = (await import('../server/api/admin/auth/logout.post')).default as unknown as (event: FakeEvent) => Promise<unknown>
const { chargeChatRateLimit } = await import('../server/utils/chatbot/chat-policy')
const { requestBase, resolveRedirectUri } = await import('../server/utils/google-oauth/config')

beforeEach(() => {
  hits.length = 0
  auditRows.length = 0
})

// ─── chat rate-limit bucket ──────────────────────────────────────────────────

const chatSettings = (requests: number) => ({ rateLimitRequests: requests, rateLimitWindowSeconds: 60 }) as never
async function chatBucket(peer: string, headers: Record<string, string> = {}): Promise<string> {
  hits.length = 0
  await chargeChatRateLimit(eventFrom(peer, headers) as never, chatSettings(1000))
  assert.equal(hits.length, 1)
  return hits[0]!
}

test('chat bucket: behind the listed proxy, each visitor gets their own bucket (not one global one)', async () => {
  const visitorA = await chatBucket('127.0.0.1', { 'x-forwarded-for': REAL_VISITOR })
  const visitorB = await chatBucket('127.0.0.1', { 'x-forwarded-for': '192.0.2.45' })
  assert.notEqual(visitorA, visitorB)
  assert.equal(visitorA, await chatBucket(REAL_VISITOR), 'the bucket is the one of the resolved address')
  assert.notEqual(visitorA, await chatBucket('127.0.0.1'), 'and not the proxy\'s own')
})

test('chat bucket: a stranger\'s forged x-forwarded-for does not choose their bucket', async () => {
  const plain = await chatBucket(STRANGER)
  assert.equal(await chatBucket(STRANGER, { 'x-forwarded-for': FORGED }), plain)
  assert.equal(await chatBucket(STRANGER, { 'x-forwarded-for': '10.1.2.3, 127.0.0.1', 'x-real-ip': '10.9.9.9' }), plain)
  assert.notEqual(plain, await chatBucket(FORGED), 'the forged address was not adopted')
})

test('chat limit: rotating the forged header does not buy a stranger more requests', async () => {
  const outcomes: Array<number | null> = []
  for (let n = 0; n < 5; n++) {
    outcomes.push(await chargeChatRateLimit(eventFrom('203.0.113.200', { 'x-forwarded-for': `198.51.100.${n}` }) as never, chatSettings(2)))
  }
  assert.deepEqual(outcomes.map(value => value === null), [true, true, false, false, false])
})

// ─── admin logout audit row ──────────────────────────────────────────────────

const admin = { id: 7, username: 'canbo7' }
async function loggedIp(peer: string, headers: Record<string, string> = {}): Promise<unknown> {
  auditRows.length = 0
  await logout(eventFrom(peer, headers, { adminUser: admin }))
  assert.equal(auditRows.length, 1)
  assert.equal(auditRows[0]!.action, 'logout')
  return (auditRows[0]!.meta as { ip: unknown }).ip
}

test('logout audit: the row records the resolved address, never what the caller claimed', async () => {
  assert.equal(await loggedIp(STRANGER, { 'x-forwarded-for': FORGED }), STRANGER, 'forged header from a stranger is ignored')
  assert.equal(await loggedIp(STRANGER), STRANGER)
  assert.equal(await loggedIp('127.0.0.1', { 'x-forwarded-for': REAL_VISITOR }), REAL_VISITOR, 'through the listed proxy it is the visitor, not the proxy')
  assert.equal(await loggedIp('127.0.0.1', { 'x-forwarded-for': `${FORGED}, ${REAL_VISITOR}` }), REAL_VISITOR, 'the hop our proxy appended wins over what the client prepended')
})

// ─── OAuth redirect base ─────────────────────────────────────────────────────

const forwardedHeaders = { host: 'portal.example.vn', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'http' }

test('oauth redirect: forwarded host and proto are ignored when the peer is not a listed proxy', () => {
  assert.equal(requestBase(eventFrom(STRANGER, forwardedHeaders) as never), 'https://portal.example.vn')
  assert.equal(resolveRedirectUri(eventFrom(STRANGER, forwardedHeaders) as never), 'https://portal.example.vn/api/auth/google/callback')
})

test('oauth redirect: a forged x-forwarded-for cannot promote the stranger to a trusted proxy', () => {
  // If the peer were read with the forwarded chain, "127.0.0.1" here would make it look like our own proxy.
  const forged = { ...forwardedHeaders, 'x-forwarded-for': '127.0.0.1' }
  assert.equal(requestBase(eventFrom(STRANGER, forged) as never), 'https://portal.example.vn')
})

test('oauth redirect: through the listed proxy the forwarded host and proto are honoured', () => {
  assert.equal(requestBase(eventFrom('127.0.0.1', { ...forwardedHeaders, 'x-forwarded-host': 'cdn.portal.example.vn', 'x-forwarded-proto': 'https' }) as never), 'https://cdn.portal.example.vn')
  assert.equal(requestBase(eventFrom('::ffff:127.0.0.1', forwardedHeaders) as never), 'http://evil.example', 'a listed proxy is believed, whatever it forwards')
})
