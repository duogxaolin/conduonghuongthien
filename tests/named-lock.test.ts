import assert from 'node:assert/strict'
import test from 'node:test'
import { withNamedLock } from '../server/utils/named-lock'

/**
 * `withNamedLock` replaces three near-identical copies of the same twenty lines —
 * `GET_LOCK`, an `acquired` check, a `held` flag, `RELEASE_LOCK` in a `finally`,
 * `connection.release()`. Its whole value is the two branches it must not get
 * wrong:
 *
 *   • the lock is BUSY  → the action must not run, and the caller must still be
 *     able to write on the connection (that branch carries the only NOC signal
 *     analytics maintenance emits);
 *   • the lock is HELD  → the action runs on THAT connection, the value comes
 *     back, and the lock is released whatever the action does.
 *
 * Both are modelled here with a lock table keyed by name, so "another replica
 * holds it" is a state the fake can actually be in rather than a canned reply.
 * The failure this guards against is the expensive one: a scheduler that runs
 * its delete body believing it holds a lock it never got, so two replicas purge
 * at the same time and neither reports anything wrong.
 */

type Query = { sql: string; params: unknown[] }

/**
 * A pool whose connections share one lock table, which is what makes the
 * concurrency case real: `GET_LOCK` on a second connection sees the first
 * connection's hold and answers 0.
 */
function fakePool() {
  const queries: Query[] = []
  const held = new Map<string, number>()
  let nextId = 1
  let released = 0

  const pool = {
    async getConnection() {
      const id = nextId
      nextId += 1
      let closed = false
      return {
        id,
        async query(sql: string, params: unknown[] = []) {
          queries.push({ sql, params })
          if (sql.includes('GET_LOCK')) {
            const name = String(params[0])
            const owner = held.get(name)
            // A lock already held by THIS connection is re-entrant and returns 1.
            if (owner === undefined || owner === id) {
              held.set(name, id)
              return [[{ acquired: 1 }]]
            }
            // Timeout 0 is "do not wait": report busy immediately.
            return [[{ acquired: 0 }]]
          }
          if (sql.includes('RELEASE_LOCK')) {
            const name = String(params[0])
            if (held.get(name) === id) held.delete(name)
            return [[{ released: 1 }]]
          }
          throw new Error(`unexpected statement: ${sql}`)
        },
        release() {
          closed = true
          released += 1
          // MySQL drops a connection's named locks when the connection drops.
          for (const [name, owner] of held) if (owner === id) held.delete(name)
        },
        get closed() { return closed },
      }
    },
    get queries() { return queries },
    get heldNames() { return [...held.keys()] },
    get released() { return released },
  }
  return pool
}

test('a second concurrent acquisition with timeout 0 returns without running the action', async () => {
  const pool = fakePool()
  const ran: string[] = []

  const first = withNamedLock(pool as never, 'cdkt:test:lock', 0, async () => {
    ran.push('first')
    // The second acquisition happens while the first still holds the lock —
    // exactly what a second replica does mid-purge.
    const second = await withNamedLock(pool as never, 'cdkt:test:lock', 0, async () => {
      ran.push('second')
      return 'second'
    })
    assert.deepEqual(second, { acquired: false }, 'the busy branch must report it did not acquire')
    return 'first'
  })

  assert.deepEqual(await first, { acquired: true, value: 'first' })
  assert.deepEqual(ran, ['first'], 'the action ran even though the lock was already held')
})

test('the busy branch still hands the caller the connection so it can write', async () => {
  const pool = fakePool()
  const busyWrites: unknown[] = []

  await withNamedLock(pool as never, 'cdkt:test:lock', 0, async () => 'held')
  // The holder's connection released the lock in its `finally`, so re-take it on
  // a fresh connection and then contend from inside.
  const outcome = await withNamedLock(pool as never, 'cdkt:test:lock', 0, async () => {
    const contended = await withNamedLock(
      pool as never,
      'cdkt:test:lock',
      0,
      async () => 'never',
      async (connection) => { busyWrites.push(connection) },
    )
    assert.deepEqual(contended, { acquired: false })
    return 'ok'
  })

  assert.deepEqual(outcome, { acquired: true, value: 'ok' })
  assert.equal(busyWrites.length, 1, 'the lock-busy hook was never called — the NOC signal would be lost')
  assert.ok(busyWrites[0], 'the lock-busy hook received nothing to write on')
})

test('a busy acquisition issues no RELEASE_LOCK for a lock it does not hold', async () => {
  const pool = fakePool()
  await withNamedLock(pool as never, 'cdkt:test:lock', 0, async () => {
    await withNamedLock(pool as never, 'cdkt:test:lock', 0, async () => 'never')
    return null
  })

  // One release for the holder, none for the contender: releasing a lock you do
  // not hold does nothing, but the statement is a symptom of a branch that
  // believes it acquired something.
  assert.equal(pool.queries.filter(q => q.sql.includes('RELEASE_LOCK')).length, 1)
})

test('the lock is released and the connection returned even when the action throws', async () => {
  const pool = fakePool()

  await assert.rejects(
    withNamedLock(pool as never, 'cdkt:test:lock', 0, async () => { throw new Error('purge blew up') }),
    /purge blew up/,
  )

  assert.deepEqual(pool.heldNames, [], 'the lock was left held — the next run would skip forever')
  assert.equal(pool.released, 1, 'the connection was never returned to the pool')
})

test('the lock is released and the connection returned on the success path too', async () => {
  const pool = fakePool()
  const outcome = await withNamedLock(pool as never, 'cdkt:test:lock', 0, async () => 42)

  assert.deepEqual(outcome, { acquired: true, value: 42 })
  assert.deepEqual(pool.heldNames, [])
  assert.equal(pool.released, 1)
})

test('the timeout is passed through so a stale lock cannot be waited out', async () => {
  const pool = fakePool()
  await withNamedLock(pool as never, 'cdkt:test:lock', 0, async () => null)

  const getLock = pool.queries.find(q => q.sql.includes('GET_LOCK'))
  assert.deepEqual(getLock?.params, ['cdkt:test:lock', 0], 'a non-zero timeout would queue instead of skipping')
})

test('a negative timeout is refused rather than passed to MySQL as wait-forever', async () => {
  const pool = fakePool()
  // MySQL reads a negative timeout as "wait indefinitely", which would block a
  // scheduler tick on a pooled connection until the holder finished — the exact
  // queueing behaviour every call site exists to avoid.
  await assert.rejects(
    withNamedLock(pool as never, 'cdkt:test:lock', -1, async () => null),
    /non-negative integer timeout/,
  )
  assert.equal(pool.queries.length, 0, 'a refused timeout still reached the database')
})

test('a non-integer timeout is refused as well', async () => {
  for (const bad of [1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assert.rejects(
      withNamedLock(fakePool() as never, 'cdkt:test:lock', bad, async () => null),
      /non-negative integer timeout/,
      `accepted: ${String(bad)}`,
    )
  }
})
