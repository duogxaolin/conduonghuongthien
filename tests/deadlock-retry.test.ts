import assert from 'node:assert/strict'
import test from 'node:test'
import { DEADLOCK_ATTEMPTS, isDeadlock, withDeadlockRetry } from '../server/utils/deadlock-retry'

/**
 * `withDeadlockRetry` (server/utils/deadlock-retry.ts): a transaction InnoDB rolled back as a
 * deadlock victim (1213) runs again, at most DEADLOCK_ATTEMPTS times in all; nothing else is
 * retried — a lock-wait timeout (1205) has already waited 50 s. Drizzle wraps the driver's
 * error, so 1213 is found down the `cause` chain. The behaviour through a real ban / account
 * deletion is in reader-moderation-behavior; the deadlock itself is replayed on MySQL 8.
 */

const deadlock = () => Object.assign(new Error('Deadlock found when trying to get lock'), { errno: 1213, code: 'ER_LOCK_DEADLOCK' })
const wrapped = (cause: unknown) => Object.assign(new Error('Failed query: update `reader_accounts` …'), { cause })
const noSleep = { sleep: async () => {} }

test('isDeadlock: 1213 or ER_LOCK_DEADLOCK on the error or down its cause chain; nothing else', () => {
  assert.equal(isDeadlock(deadlock()), true)
  assert.equal(isDeadlock(wrapped(wrapped(deadlock()))), true)
  assert.equal(isDeadlock(Object.assign(new Error('x'), { code: 'ER_LOCK_DEADLOCK' })), true)
  for (const other of [Object.assign(new Error('Lock wait timeout exceeded'), { errno: 1205 }), new Error('1213'), null, 'deadlock', { errno: '1213' }]) {
    assert.equal(isDeadlock(other), false, String(other))
  }
})

test('a deadlock victim runs again and its result is returned; at most DEADLOCK_ATTEMPTS attempts in all', async () => {
  let calls = 0
  assert.equal(await withDeadlockRetry(async () => { calls += 1; if (calls < 3) throw wrapped(deadlock()); return 'ok' }, noSleep), 'ok')
  assert.equal(calls, 3)
  assert.equal(DEADLOCK_ATTEMPTS, 3)

  calls = 0
  await assert.rejects(withDeadlockRetry(async () => { calls += 1; throw wrapped(deadlock()) }, noSleep), /Failed query/)
  assert.equal(calls, DEADLOCK_ATTEMPTS)
})

test('any other error — a lock-wait timeout included — is thrown at once, never retried', async () => {
  for (const error of [Object.assign(new Error('Lock wait timeout exceeded'), { errno: 1205 }), new Error('boom')]) {
    let calls = 0
    await assert.rejects(withDeadlockRetry(async () => { calls += 1; throw error }, noSleep), error)
    assert.equal(calls, 1, error.message)
  }
})

test('the pause between attempts is a short jitter (5–25 ms)', async () => {
  const pauses: number[] = []
  let calls = 0
  await withDeadlockRetry(async () => { calls += 1; if (calls < 3) throw deadlock() }, { sleep: async (ms) => { pauses.push(ms) } })
  assert.equal(pauses.length, 2)
  assert.ok(pauses.every(ms => ms >= 5 && ms <= 25), pauses.join(','))
})
