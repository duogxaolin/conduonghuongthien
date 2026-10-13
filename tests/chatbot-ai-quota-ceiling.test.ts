import assert from 'node:assert/strict'
import test from 'node:test'
import { AI_IP_CEILING_RULE, AI_QUOTA_RULE, enforceAiQuota, type ChatEvent } from '../server/utils/chatbot/chat-policy'
import type { RateLimitDeps } from '../server/utils/rate-limit-store'

/**
 * The AI allowance is 20 calls an hour per session — but a session token is free:
 * `/api/public/chatbot/session` signs one for anybody, statelessly. Asking for a
 * fresh token reset the allowance to zero, so the only bound left was the chat
 * rate limit (10 requests a minute = up to 600 provider calls an hour from one
 * address, thirty times the intended allowance). The per-address ceiling is that
 * missing bound. These tests farm tokens the way a script would.
 */

const memoryDeps = (): RateLimitDeps => ({ execute: null, memory: new Map() })

function eventFrom(address: string): ChatEvent {
  return { node: { req: { headers: {}, socket: { remoteAddress: address } } }, context: {} } as unknown as ChatEvent
}

async function callsUntilBlocked(event: ChatEvent, deps: RateLimitDeps, session: (n: number) => string | null, max: number): Promise<number> {
  for (let n = 0; n < max; n++) {
    if (await enforceAiQuota(event, session(n), deps)) return n
  }
  return max
}

test('one session is still held to its own allowance', async () => {
  const deps = memoryDeps()
  const event = eventFrom('203.0.113.10')
  assert.equal(await callsUntilBlocked(event, deps, () => 'one-session', 100), AI_QUOTA_RULE.limit)
})

test('minting a fresh token for every call no longer resets the allowance', async () => {
  const deps = memoryDeps()
  const event = eventFrom('203.0.113.11')
  // Every call carries a brand-new token: the per-session counter never moves.
  const allowed = await callsUntilBlocked(event, deps, n => `farmed-token-${n}`, 1000)
  assert.equal(allowed, AI_IP_CEILING_RULE.limit, `a token-farming client got ${allowed} provider calls from one address in an hour`)
  assert.ok(allowed < 600, 'must be well under what the chat rate limit alone allowed')
})

test('the ceiling is per address: another visitor is unaffected', async () => {
  const deps = memoryDeps()
  const farmer = eventFrom('203.0.113.12')
  await callsUntilBlocked(farmer, deps, n => `farm-${n}`, 1000)
  assert.equal(await enforceAiQuota(eventFrom('198.51.100.7'), 'honest-visitor', deps), null)
  assert.equal(await enforceAiQuota(farmer, 'farm-fresh', deps) !== null, true, 'the farming address stays blocked')
})

test('a small office behind one address has room for each person\'s own allowance', async () => {
  const deps = memoryDeps()
  const office = eventFrom('203.0.113.13')
  // Five people each use their whole allowance: exactly the ceiling.
  for (let person = 0; person < 5; person++) {
    for (let call = 0; call < AI_QUOTA_RULE.limit; call++) {
      assert.equal(await enforceAiQuota(office, `person-${person}`, deps), null, `person ${person}, call ${call}`)
    }
  }
  assert.ok(await enforceAiQuota(office, 'person-6', deps), 'the sixth person is past the address ceiling')
})

test('a visitor without a token is counted per address at the session limit', async () => {
  const deps = memoryDeps()
  assert.equal(await callsUntilBlocked(eventFrom('203.0.113.14'), deps, () => null, 100), AI_QUOTA_RULE.limit)
})

test('a call refused by the session quota does not spend the address ceiling', async () => {
  const deps = memoryDeps()
  const event = eventFrom('203.0.113.15')
  for (let n = 0; n < AI_QUOTA_RULE.limit; n++) await enforceAiQuota(event, 'busy', deps)
  for (let n = 0; n < 50; n++) assert.ok(await enforceAiQuota(event, 'busy', deps), 'still refused')
  // 20 were allowed; the 50 refusals must not have eaten into the other 80.
  const rest = await callsUntilBlocked(event, deps, n => `other-${n}`, 1000)
  assert.equal(rest, AI_IP_CEILING_RULE.limit - AI_QUOTA_RULE.limit)
})

test('the ceiling is a multiple of the session allowance, not a lower number', () => {
  // A ceiling at or under the session allowance would make the per-session limit
  // meaningless and would throttle every shared connection.
  assert.ok(AI_IP_CEILING_RULE.limit >= AI_QUOTA_RULE.limit * 3)
  assert.equal(AI_IP_CEILING_RULE.windowSeconds, AI_QUOTA_RULE.windowSeconds)
})
