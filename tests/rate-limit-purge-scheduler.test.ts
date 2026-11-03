import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

/**
 * Lifecycle of the counter-purge timer (design D16).
 *
 * Found by independent verification of 9cf1bb8: `stopRateLimitPurgeScheduler`
 * was never called, and it did not clear the 90 s warm-up timer — a stop
 * shortly after boot still swept once. Now stop clears both, and the plugin
 * calls it on Nitro `close`.
 *
 * Timers are node:test mock timers; the database edge is a fake pool that only
 * counts connection attempts (each sweep starts with one).
 */

let connections = 0
mock.module('../server/utils/db', {
  namedExports: {
    getPool: () => ({
      async getConnection() {
        connections += 1
        throw new Error('fake pool: no database in this test')
      },
    }),
  },
})
let retentionStarted = 0
mock.module('../server/services/retention-scheduler', {
  namedExports: { startRetentionScheduler: () => { retentionStarted += 1 } },
})

const scheduler = await import('../server/services/rate-limit-purge-scheduler')
const WARMUP_MS = 90_000

/** Let the sweep's promise chain run after a timer fired. */
const settle = () => new Promise(resolve => setImmediate(resolve))

test('stopped before the warm-up fires: nothing ever sweeps', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  connections = 0
  scheduler.startRateLimitPurgeScheduler()
  scheduler.stopRateLimitPurgeScheduler()
  t.mock.timers.tick(WARMUP_MS + scheduler.RATE_LIMIT_PURGE_TICK_MS * 3)
  await settle()
  assert.equal(connections, 0, 'the warm-up timer survived stop and swept anyway')
})

test('running: the warm-up sweeps once, then every tick; stop ends it', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  connections = 0
  scheduler.startRateLimitPurgeScheduler()
  t.mock.timers.tick(WARMUP_MS)
  await settle()
  assert.equal(connections, 1)
  t.mock.timers.tick(scheduler.RATE_LIMIT_PURGE_TICK_MS)
  await settle()
  assert.ok(connections >= 2, 'the interval did not sweep')
  const seen = connections
  scheduler.stopRateLimitPurgeScheduler()
  t.mock.timers.tick(scheduler.RATE_LIMIT_PURGE_TICK_MS * 3)
  await settle()
  assert.equal(connections, seen, 'still sweeping after stop')
})

test('the plugin stops the timer when Nitro closes', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  const hooks = new Map<string, Array<() => unknown>>()
  const globals = globalThis as Record<string, unknown>
  globals.defineNitroPlugin = (plugin: unknown) => plugin
  const previous = process.env.RETENTION_SCHEDULER
  process.env.RETENTION_SCHEDULER = '1'
  try {
    const plugin = (await import('../server/plugins/retention-scheduler.ts')).default as unknown as (app: unknown) => void
    plugin({ hooks: { hook: (name: string, fn: () => unknown) => { hooks.set(name, [...(hooks.get(name) ?? []), fn]) } } })
    assert.equal(retentionStarted, 1)
    const close = hooks.get('close') ?? []
    assert.ok(close.length > 0, 'no close hook registered')

    connections = 0
    for (const fn of close) await fn()
    t.mock.timers.tick(WARMUP_MS + scheduler.RATE_LIMIT_PURGE_TICK_MS * 2)
    await settle()
    assert.equal(connections, 0, 'the purge kept running after Nitro closed')
  } finally {
    if (previous === undefined) delete process.env.RETENTION_SCHEDULER
    else process.env.RETENTION_SCHEDULER = previous
  }
})
