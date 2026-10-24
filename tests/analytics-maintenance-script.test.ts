import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

/**
 * `npm run analytics:maintenance` (the cron entry point) and the rate-limit
 * counter purge.
 *
 * Found by independent verification of 9cf1bb8: the purge was an unwrapped
 * `await runRateLimitPurgePass()`, so a database error rejected the top-level
 * await — no JSON line for the operator, `closeDb()` skipped — and it was
 * skipped entirely whenever analytics maintenance failed. With
 * RETENTION_SCHEDULER=0 cron may be the ONLY path that purges the table.
 *
 * Runs the real script (imported fresh per case) with the three services and
 * the database layer mocked at their module boundaries; the purge itself is
 * the real `rate-limit-purge-scheduler.ts` over a fake pool.
 */

const state = {
  analyticsStatus: 'success' as string,
  analyticsThrows: null as string | null,
  retentionThrows: null as string | null,
  retentionCalls: 0,
  closeDbCalls: 0,
  pool: null as unknown,
  purgeConnections: 0,
}

mock.module('../server/services/analytics-maintenance', {
  namedExports: {
    runAnalyticsMaintenance: async () => {
      if (state.analyticsThrows) throw new Error(state.analyticsThrows)
      return { status: state.analyticsStatus, processedDays: 0, purgedRaw: 0, purgedAggregates: 0, lastAggregatedDay: null, stale: false }
    },
  },
})
mock.module('../server/services/retention-scheduler', {
  namedExports: {
    runRetentionPass: async () => {
      state.retentionCalls += 1
      // `runRetentionPass` reads the policy through getDb() outside any catch and
      // its lock block has no catch either, so it can reject.
      if (state.retentionThrows) throw new Error(state.retentionThrows)
      return { ran: false, reason: 'disabled' }
    },
  },
})

/** Each case starts from a clean slate. */
function reset(overrides: Partial<typeof state>) {
  Object.assign(state, {
    analyticsStatus: 'success', analyticsThrows: null, retentionThrows: null,
    retentionCalls: 0, closeDbCalls: 0, pool: null, purgeConnections: 0,
  }, overrides)
}
mock.module('../server/utils/db', {
  namedExports: {
    getPool: () => state.pool,
    getDb: () => { throw new Error('not used') },
    closeDb: async () => { state.closeDbCalls += 1 },
  },
})

const downPool = {
  async getConnection() {
    state.purgeConnections += 1
    throw new Error('connect ECONNREFUSED 127.0.0.1:3306')
  },
}
function healthyPool(deleted: number) {
  const connection = {
    release() {},
    async query(sql: string) {
      if (sql.startsWith('SELECT GET_LOCK')) return [[{ acquired: 1 }]]
      if (sql.startsWith('SELECT RELEASE_LOCK')) return [[{ released: 1 }]]
      if (sql.startsWith('DELETE FROM rate_limit_counters')) return [{ affectedRows: deleted }]
      throw new Error(`unexpected statement: ${sql}`)
    },
  }
  return {
    async getConnection() {
      state.purgeConnections += 1
      return connection
    },
  }
}

let run = 0
async function runScript(): Promise<Record<string, unknown>> {
  const printed: string[] = []
  const original = console.log
  console.log = (...args: unknown[]) => { printed.push(args.map(String).join(' ')) }
  let rejected: unknown = null
  try {
    run += 1
    await import(`../scripts/analytics-maintenance.ts?case=${run}`)
  } catch (error) {
    rejected = error
  } finally {
    console.log = original
  }
  assert.equal(rejected, null, `the script rejected instead of reporting: ${String(rejected)}`)
  // The logger prints JSON lines too; the result is the one with the job's fields.
  const line = printed.find(text => text.startsWith('{') && text.includes('"scheduler"'))
  assert.ok(line, 'the script printed no JSON result')
  return JSON.parse(line) as Record<string, unknown>
}

test('retention throws after analytics succeeded: JSON still printed, purge still runs, pool closed, exit 1', async () => {
  reset({ retentionThrows: 'ECONNRESET during retention', pool: healthyPool(7) })
  try {
    const output = await runScript()
    const retention = output.retention as { ran: boolean, error?: string }
    assert.equal(retention.ran, false)
    assert.match(retention.error ?? '', /ECONNRESET during retention/)
    assert.deepEqual(output.rateLimits, { ran: true, purged: 7, bounded: false }, 'the purge was skipped because retention threw')
    assert.equal(state.purgeConnections, 1)
    assert.equal(state.closeDbCalls, 1, 'an open pool keeps cron hanging')
    assert.equal(process.exitCode, 1)
  } finally {
    process.exitCode = 0
  }
})

test('analytics throws: reported as failed, retention skipped, purge still runs, pool closed, exit 1', async () => {
  reset({ analyticsThrows: 'Too many connections', pool: healthyPool(3) })
  try {
    const output = await runScript()
    assert.equal(output.status, 'failed')
    assert.match(String(output.error ?? ''), /Too many connections/)
    assert.equal(state.retentionCalls, 0)
    assert.deepEqual(output.rateLimits, { ran: true, purged: 3, bounded: false })
    assert.equal(state.closeDbCalls, 1)
    assert.equal(process.exitCode, 1)
  } finally {
    process.exitCode = 0
  }
})

test('analytics and retention fine, the purge fails: the job still exits 1', async () => {
  // Only the purge failed — if its failure did not count, cron would report success
  // while the counter table grows.
  reset({ pool: downPool })
  try {
    const output = await runScript()
    assert.equal(output.status, 'success')
    assert.match(String((output.rateLimits as { error?: string }).error ?? ''), /ECONNREFUSED/)
    assert.equal(state.retentionCalls, 1)
    assert.equal(process.exitCode, 1, 'a failed purge was reported as a successful run')
  } finally {
    process.exitCode = 0
  }
})

test('analytics failed and the database is down: the purge is still attempted, its error reported, the pool closed', async () => {
  reset({ analyticsStatus: 'failed', pool: downPool })
  try {
    const output = await runScript()
    const rateLimits = output.rateLimits as { ran: boolean, error?: string }
    assert.ok(rateLimits, 'the purge was skipped because analytics failed')
    assert.equal(rateLimits.ran, false)
    assert.match(rateLimits.error ?? '', /ECONNREFUSED/)
    assert.equal(state.retentionCalls, 0, 'retention keeps its rule: skipped when analytics could not run')
    assert.equal(state.closeDbCalls, 1, 'an open pool keeps cron hanging')
    assert.equal(process.exitCode, 1)
  } finally {
    process.exitCode = 0
  }
})

test('analytics failed but the database answers: cron purges the counters', async () => {
  reset({ analyticsStatus: 'failed', pool: healthyPool(1234) })
  try {
    const output = await runScript()
    assert.deepEqual(output.rateLimits, { ran: true, purged: 1234, bounded: false })
    assert.equal(state.closeDbCalls, 1)
  } finally {
    process.exitCode = 0
  }
})

test('a healthy run reports the purge and does not fail the job', async () => {
  reset({ pool: healthyPool(0) })
  try {
    const output = await runScript()
    assert.deepEqual(output.rateLimits, { ran: true, purged: 0, bounded: false })
    assert.equal(state.retentionCalls, 1)
    assert.ok(!process.exitCode, `exit code ${process.exitCode} for a clean run`)
  } finally {
    process.exitCode = 0
  }
})
