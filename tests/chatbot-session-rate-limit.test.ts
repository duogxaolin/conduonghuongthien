import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { CHAT_SESSION_MINT_ALLOWED, enforceSessionMintLimit } from '../server/utils/chatbot/session-limit'
import type { RateLimitDeps } from '../server/utils/rate-limit-store'

/**
 * `/api/public/chatbot/session` signs a session token for anybody, statelessly.
 * The AI allowance no longer depends on tokens being scarce (it has a per-address
 * ceiling, see `AI_IP_CEILING_RULE`), so this limit is defence in depth: it keeps
 * a script from hammering the endpoint and flooding the logs. It must leave room
 * for a visitor's ten conversations and for a small office behind one address.
 */

const memoryDeps = (): RateLimitDeps => ({ execute: null, memory: new Map() })
const eventFrom = (address: string) => ({ node: { req: { headers: {}, socket: { remoteAddress: address } } }, context: {} }) as never

async function mintsUntilBlocked(address: string, deps: RateLimitDeps, max: number): Promise<number> {
  for (let n = 0; n < max; n++) {
    if (await enforceSessionMintLimit(eventFrom(address), deps)) return n
  }
  return max
}

test('one address can mint exactly the allowed number of tokens per window', async () => {
  const deps = memoryDeps()
  assert.equal(await mintsUntilBlocked('203.0.113.50', deps, 1000), CHAT_SESSION_MINT_ALLOWED)
})

test('the refusal carries a retry delay in seconds', async () => {
  const deps = memoryDeps()
  const address = '203.0.113.51'
  for (let n = 0; n < CHAT_SESSION_MINT_ALLOWED; n++) await enforceSessionMintLimit(eventFrom(address), deps)
  const retryAfter = await enforceSessionMintLimit(eventFrom(address), deps)
  assert.ok(retryAfter !== null && retryAfter >= 1 && retryAfter <= 3600)
})

test('another address is unaffected by a noisy one', async () => {
  const deps = memoryDeps()
  await mintsUntilBlocked('203.0.113.52', deps, 1000)
  assert.equal(await enforceSessionMintLimit(eventFrom('198.51.100.9'), deps), null)
})

test('the allowance fits ten conversations for several visitors behind one address', () => {
  // A visitor stores at most 10 conversations (CHATBOT_CLIENT_LIMITS.maxConversations),
  // each minting one token. Five such visitors in an office must not be refused.
  assert.ok(CHAT_SESSION_MINT_ALLOWED >= 5 * 10)
})

test('the endpoint refuses with 429 and a Retry-After header, and keeps the 503 for a missing secret', () => {
  const source = readFileSync(new URL('../server/api/public/chatbot/session.post.ts', import.meta.url), 'utf8')
  assert.match(source, /enforceSessionMintLimit\(event\)/)
  assert.match(source, /statusCode:\s*429/)
  assert.match(source, /Retry-After/)
  assert.match(source, /statusCode:\s*503/)
  // The limit runs before the token is signed: a refused request must cost nothing.
  assert.ok(source.indexOf('enforceSessionMintLimit') < source.indexOf('issueSessionToken('))
})
