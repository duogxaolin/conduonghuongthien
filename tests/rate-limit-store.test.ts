import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  clearRateLimit,
  peekRateLimit,
  purgeExpiredRateLimits,
  recordRateLimitHit,
  type RateLimitRule,
} from '../server/utils/rate-limit-store'

/**
 * Login and public-form throttling used to live in a `Map` inside the worker.
 * A restart cleared every lockout, and a second replica doubled the effective
 * limit. These tests pin the shared-store behaviour and, importantly, what
 * happens when the database is unreachable — the failure mode there decides
 * whether the site is protected or wide open.
 */

const RULE: RateLimitRule = { limit: 3, windowSeconds: 900 }
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

/** A tiny stand-in for the counters table, driven through the same SQL. */
function fakeDatabase() {
  const rows = new Map<string, { hit_count: number; window_expires_at: Date }>()
  const statements: string[] = []
  return {
    rows,
    statements,
    execute: async (sql: string, params: unknown[]) => {
      statements.push(sql.replace(/\s+/g, ' ').trim())
      if (sql.startsWith('SELECT')) {
        const row = rows.get(String(params[0]))
        return [row ? [{ ...row }] : []]
      }
      if (sql.trim().startsWith('INSERT')) {
        const [key, expiresAt, now] = params as [string, Date, Date]
        const existing = rows.get(key)
        if (!existing || existing.window_expires_at <= now) {
          rows.set(key, { hit_count: 1, window_expires_at: expiresAt })
        } else {
          existing.hit_count += 1
        }
        return [{ affectedRows: 1 }]
      }
      if (sql.includes('window_expires_at <= ?')) {
        const before = params[0] as Date
        let removed = 0
        for (const [key, row] of rows) if (row.window_expires_at <= before) { rows.delete(key); removed += 1 }
        return [{ affectedRows: removed }]
      }
      if (sql.startsWith('DELETE')) {
        return [{ affectedRows: rows.delete(String(params[0])) ? 1 : 0 }]
      }
      throw new Error(`unexpected statement: ${sql}`)
    },
  }
}

// ─── Counting ────────────────────────────────────────────────────────────────
test('an unknown bucket starts clean', async () => {
  const db = fakeDatabase()
  const state = await peekRateLimit('login:ip:1.2.3.4:admin', RULE, { execute: db.execute })
  assert.deepEqual([state.count, state.blocked, state.backend], [0, false, 'database'])
})

test('attempts accumulate and block exactly at the limit', async () => {
  const db = fakeDatabase()
  const deps = { execute: db.execute, now: () => 1_000_000 }
  assert.equal((await recordRateLimitHit('k', RULE, deps)).blocked, false)
  assert.equal((await recordRateLimitHit('k', RULE, deps)).blocked, false)
  const third = await recordRateLimitHit('k', RULE, deps)
  assert.equal(third.count, 3)
  assert.equal(third.blocked, true, 'the third of three attempts did not trip the limit')
})

test('peek does not consume an attempt', async () => {
  const db = fakeDatabase()
  const deps = { execute: db.execute, now: () => 1_000_000 }
  await recordRateLimitHit('k', RULE, deps)
  await peekRateLimit('k', RULE, deps)
  await peekRateLimit('k', RULE, deps)
  assert.equal((await peekRateLimit('k', RULE, deps)).count, 1)
})

test('a blocked bucket reports how long to wait', async () => {
  const db = fakeDatabase()
  let clock = 1_000_000
  const deps = { execute: db.execute, now: () => clock }
  for (let i = 0; i < 3; i += 1) await recordRateLimitHit('k', RULE, deps)

  clock += 600_000 // ten minutes into a fifteen-minute window
  const state = await peekRateLimit('k', RULE, deps)
  assert.equal(state.blocked, true)
  assert.equal(state.retryAfterSeconds, 300)
})

test('a lapsed window restarts the count instead of resurrecting it', async () => {
  const db = fakeDatabase()
  let clock = 1_000_000
  const deps = { execute: db.execute, now: () => clock }
  for (let i = 0; i < 3; i += 1) await recordRateLimitHit('k', RULE, deps)
  assert.equal((await peekRateLimit('k', RULE, deps)).blocked, true)

  clock += RULE.windowSeconds * 1000 + 1
  assert.equal((await peekRateLimit('k', RULE, deps)).count, 0, 'an expired window still blocks')
  assert.equal((await recordRateLimitHit('k', RULE, deps)).count, 1, 'the old count carried over')
})

test('a successful login clears the bucket', async () => {
  const db = fakeDatabase()
  const deps = { execute: db.execute, now: () => 1_000_000 }
  await recordRateLimitHit('k', RULE, deps)
  await clearRateLimit('k', deps)
  assert.equal((await peekRateLimit('k', RULE, deps)).count, 0)
})

test('buckets are independent of one another', async () => {
  const db = fakeDatabase()
  const deps = { execute: db.execute, now: () => 1_000_000 }
  for (let i = 0; i < 3; i += 1) await recordRateLimitHit('login:ip:1.1.1.1:admin', RULE, deps)
  assert.equal((await peekRateLimit('login:ip:2.2.2.2:admin', RULE, deps)).blocked, false)
})

test('the counter survives a process restart', async () => {
  // Same store, brand-new in-process memory: this is what a redeploy looks like.
  const db = fakeDatabase()
  const before = { execute: db.execute, now: () => 1_000_000, memory: new Map() }
  for (let i = 0; i < 3; i += 1) await recordRateLimitHit('k', RULE, before)

  const after = { execute: db.execute, now: () => 1_000_060, memory: new Map() }
  assert.equal((await peekRateLimit('k', RULE, after)).blocked, true, 'a restart handed out a fresh quota')
})

// ─── Degradation ─────────────────────────────────────────────────────────────
test('a database outage falls back to in-process counting, not to no limit', async () => {
  const broken = {
    execute: async () => { throw new Error('ECONNREFUSED') },
    now: () => 1_000_000,
    memory: new Map(),
  }
  assert.equal((await recordRateLimitHit('k', RULE, broken)).backend, 'memory')
  await recordRateLimitHit('k', RULE, broken)
  const third = await recordRateLimitHit('k', RULE, broken)
  assert.equal(third.blocked, true, 'the fallback stopped counting — the endpoint is unthrottled')
})

test('with no database configured at all the limiter still counts', async () => {
  const deps = { now: () => 1_000_000, memory: new Map() }
  for (let i = 0; i < 2; i += 1) await recordRateLimitHit('k', RULE, deps)
  assert.equal((await peekRateLimit('k', RULE, deps)).count, 2)
  assert.equal((await recordRateLimitHit('k', RULE, deps)).blocked, true)
})

// ─── Housekeeping ────────────────────────────────────────────────────────────
test('expired buckets are removed, live ones are left alone', async () => {
  const db = fakeDatabase()
  let clock = 1_000_000
  const deps = { execute: db.execute, now: () => clock, memory: new Map() }
  await recordRateLimitHit('old', RULE, deps)
  clock += RULE.windowSeconds * 1000 + 1
  await recordRateLimitHit('fresh', RULE, deps)

  assert.equal(await purgeExpiredRateLimits(deps), 1)
  assert.deepEqual([...db.rows.keys()], ['fresh'])
})

// ─── Wiring ──────────────────────────────────────────────────────────────────
test('login counts every failure branch, including the disabled account', async () => {
  const source = read('server/api/admin/auth/login.post.ts')
  // Three 401 branches: unknown user, disabled account, wrong password. If the
  // disabled branch skipped the counter it would answer faster than the others
  // and become an account-enumeration oracle.
  const recorded = source.match(/recordRateLimitHit\(ipBucket/g) ?? []
  assert.equal(recorded.length, 3, `only ${recorded.length} of 3 failure branches count against the limit`)
  assert.doesNotMatch(source, /new Map<string, \{ count: number/, 'the in-process limiter is back')
  assert.match(source, /clearRateLimit\(ipBucket/)
})

test('login throttles per source and per account, with different ceilings', async () => {
  const source = read('server/api/admin/auth/login.post.ts')
  assert.match(source, /const IP_RULE: RateLimitRule = \{ limit: 5/)
  assert.match(source, /const USER_RULE: RateLimitRule = \{ limit: 15/)
  assert.match(source, /login:ip:\$\{ip\}:\$\{userKey\}/)
  assert.match(source, /login:user:\$\{userKey\}/)
})

test('both throttled endpoints tell the caller when to come back', async () => {
  for (const path of ['server/api/admin/auth/login.post.ts', 'server/api/submissions.post.ts']) {
    assert.match(read(path), /setResponseHeader\(event, 'Retry-After'/, `${path} returns 429 with no Retry-After`)
  }
})

test('the public form no longer keeps its own in-process buckets', async () => {
  const source = read('server/api/submissions.post.ts')
  assert.doesNotMatch(source, /new Map<string, number\[\]>/)
  assert.match(source, /await submitRateLimited\(clientIp\)/, 'the async limiter is called without await')
})
