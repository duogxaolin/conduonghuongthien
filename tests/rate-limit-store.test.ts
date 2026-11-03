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

  assert.equal((await purgeExpiredRateLimits(deps)).deleted, 1)
  assert.deepEqual([...db.rows.keys()], ['fresh'])
})

/**
 * A table of N rows that honours `DELETE … WHERE window_expires_at <= ? LIMIT ?`
 * exactly as MySQL would: at most LIMIT rows per statement, only expired ones.
 * The purge used to issue ONE `LIMIT 5000` statement per night, while article
 * views alone write one bucket per (article, visitor, day) — the table only grew.
 */
function bulkCounterTable(expired: number, live = 0) {
  const now = 5_000_000
  const rows: Array<{ expiresAt: number }> = []
  for (let i = 0; i < expired; i += 1) rows.push({ expiresAt: now - 1 - (i % 1000) })
  for (let i = 0; i < live; i += 1) rows.push({ expiresAt: now + 60_000 })
  const limits: unknown[] = []
  return {
    now,
    limits,
    get size() { return rows.length },
    get liveLeft() { return rows.filter(row => row.expiresAt > now).length },
    execute: async (sql: string, params: unknown[]) => {
      const text = sql.replace(/\s+/g, ' ').trim()
      assert.match(text, /^DELETE FROM rate_limit_counters WHERE window_expires_at <= \? LIMIT \?$/)
      const before = (params[0] as Date).getTime()
      const limit = params[1] as number
      limits.push(limit)
      let removed = 0
      for (let i = rows.length - 1; i >= 0 && removed < limit; i -= 1) {
        if (rows[i]!.expiresAt <= before) { rows.splice(i, 1); removed += 1 }
      }
      return [{ affectedRows: removed }]
    },
  }
}

test('a backlog larger than one batch is drained in one run, 5 000 rows per statement', async () => {
  const table = bulkCounterTable(12_000, 7)
  const result = await purgeExpiredRateLimits({ execute: table.execute, now: () => table.now, memory: new Map() })

  assert.equal(result.deleted, 12_000, 'rows past the first batch were left for another night')
  assert.equal(result.bounded, false)
  assert.equal(result.batches, 3)
  assert.deepEqual(table.limits, [5000, 5000, 5000], 'every statement is bounded by the batch size')
  assert.equal(table.size, 7, 'only live buckets remain')
  assert.equal(table.liveLeft, 7, 'a live bucket was deleted')
})

test('one run stops after 10 batches and reports the rest as unfinished', async () => {
  const table = bulkCounterTable(60_000)
  const result = await purgeExpiredRateLimits({ execute: table.execute, now: () => table.now, memory: new Map() })

  assert.equal(table.limits.length, 10, 'the per-run cap of 10 statements was not respected')
  assert.equal(result.deleted, 50_000)
  assert.equal(result.bounded, true, 'a capped run must not look like a finished one')
  assert.equal(table.size, 10_000, 'the remainder is left for the next tick')
})

test('an exactly-full last batch costs one extra empty statement, not an endless loop', async () => {
  const table = bulkCounterTable(10_000)
  const result = await purgeExpiredRateLimits({ execute: table.execute, now: () => table.now, memory: new Map() })
  assert.equal(result.deleted, 10_000)
  assert.equal(result.bounded, false)
  assert.deepEqual(table.limits, [5000, 5000, 5000])
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
