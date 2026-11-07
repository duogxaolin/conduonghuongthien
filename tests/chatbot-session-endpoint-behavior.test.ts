import assert from 'node:assert/strict'
import test, { after, beforeEach, mock } from 'node:test'
import { installH3Globals, startHandlerServer } from './_h3-handler-server'

/**
 * `POST /api/public/chatbot/session` mints a chat session token for anybody.
 *
 * Before this file the endpoint's two refusals and their ORDER were pinned only by
 * regexes over `session.post.ts` (`chatbot-session-rate-limit.test.ts`: the literals
 * `enforceSessionMintLimit(event)`, `statusCode: 429`, `Retry-After`, `statusCode: 503`
 * and `indexOf(limit) < indexOf(issueSessionToken)`). Here the real handler runs behind
 * a real h3 server, with the real rate-limit store (in-process memory, as it runs when
 * the pool is unavailable) and the real token signer; the signer is wrapped only to count
 * how many tokens were actually cut.
 */

let hmacSecret = 'test-hmac-secret-for-chat-session-tokens'
let tokensCut = 0

const memoryOnlyDb = { getPool: () => null, getDb: () => { throw new Error('the session endpoint must not touch the database') } }
mock.module('../server/utils/db', { namedExports: memoryOnlyDb })

const realSessionToken = await import('../server/utils/chatbot/session-token')
mock.module('../server/utils/chatbot/session-token', {
  namedExports: {
    ...realSessionToken,
    issueSessionToken: (secret: string) => { tokensCut += 1; return realSessionToken.issueSessionToken(secret) },
  },
})

installH3Globals()
;(globalThis as Record<string, unknown>).useRuntimeConfig = () => ({ analytics: { hmacSecret } })

const { CHAT_SESSION_MINT_ALLOWED } = await import('../server/utils/chatbot/session-limit')
const { clearRateLimit } = await import('../server/utils/rate-limit-store')
const handler = (await import('../server/api/public/chatbot/session.post')).default

const server = await startHandlerServer([{ method: 'post', path: '/api/public/chatbot/session', handler }])
after(() => server.close())

// The h3 peer is loopback, which is a trusted proxy, so `x-forwarded-for` names the visitor
// (the same resolution nginx gives production) — a different value is a different visitor.
const mint = (address: string) => server.request('POST', '/api/public/chatbot/session', { headers: { 'x-forwarded-for': address } })

beforeEach(async () => {
  hmacSecret = 'test-hmac-secret-for-chat-session-tokens'
  tokensCut = 0
  for (const address of ['203.0.113.60', '203.0.113.61', '203.0.113.62', '198.51.100.7']) {
    await clearRateLimit(`chat-session:${address}`, {})
  }
})

test('an address gets exactly the allowed number of tokens, then 429 with Retry-After and no token', async () => {
  for (let n = 0; n < CHAT_SESSION_MINT_ALLOWED; n++) {
    const response = await mint('203.0.113.60')
    assert.equal(response.status, 200, `mint ${n + 1} is inside the allowance`)
    assert.match(String(response.body.token), /^[0-9a-f-]{36}\.[0-9a-f]{32}$/)
  }
  assert.equal(tokensCut, CHAT_SESSION_MINT_ALLOWED)

  const refused = await mint('203.0.113.60')
  assert.equal(refused.status, 429)
  const retryAfter = Number(refused.headers.get('retry-after'))
  assert.ok(Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= 3600, `Retry-After is a delay in seconds, got ${refused.headers.get('retry-after')}`)
  assert.equal(refused.body.token, undefined, 'the refusal carries no token')
  assert.equal(tokensCut, CHAT_SESSION_MINT_ALLOWED, 'a refused request costs nothing: no token was signed for it')

  const again = await mint('203.0.113.60')
  assert.equal(again.status, 429, 'it stays refused for the rest of the window')
  assert.equal(tokensCut, CHAT_SESSION_MINT_ALLOWED)
})

test('another address is not affected by a noisy one', async () => {
  for (let n = 0; n <= CHAT_SESSION_MINT_ALLOWED; n++) await mint('203.0.113.61')
  assert.equal((await mint('203.0.113.61')).status, 429)
  const other = await mint('198.51.100.7')
  assert.equal(other.status, 200)
  assert.ok(other.body.token)
})

test('without the HMAC secret the endpoint answers 503, signs nothing and spends no allowance', async () => {
  hmacSecret = ''
  for (let n = 0; n < CHAT_SESSION_MINT_ALLOWED + 5; n++) {
    const response = await mint('203.0.113.62')
    assert.equal(response.status, 503)
    assert.equal(response.body.token, undefined)
  }
  assert.equal(tokensCut, 0)

  // The 503 never reached the limiter: once the secret is back the full allowance is still there.
  hmacSecret = 'test-hmac-secret-for-chat-session-tokens'
  for (let n = 0; n < CHAT_SESSION_MINT_ALLOWED; n++) assert.equal((await mint('203.0.113.62')).status, 200)
  assert.equal((await mint('203.0.113.62')).status, 429)
})
