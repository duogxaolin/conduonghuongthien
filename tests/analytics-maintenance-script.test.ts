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
  retentionCalls: 0,
  closeDbCalls: 0,
  pool: null as unknown,
}

mock.module('../server/services/analytics-maintenance', {
  namedExports: {
    runAnalyticsMaintenance: async () => ({
      status: state.analyticsStatus, processedDays: 0, purgedRaw: 0, purgedAggregates: 0, lastAggregatedDay: null, stale: false,
    }),
  },
})
mock.module('../server/services/retention-scheduler', {
  namedExports: {
    runRetentionPass: async () => {
      state.retentionCalls += 1
      return { ran: false, reason: 'disabled' }
    },
  },
})
mock.module('../server/utils/db', {
  namedExports: {
    getPool: () => state.pool,
    getDb: () => { throw new Error('not used') },
    closeDb: async () => { state.closeDbCalls += 1 },
  },
})

const downPool = { async getConnection() { throw new Error('connect ECONNREFUSED 127.0.0.1:3306') } }
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
  return { async getConnection() { return connection } }
}

let run = 0
async function runScript(): Promise<Record<string, unknown>> {
  const printed: string[] = []
  const original = console.log
  console.log = (...args: unknown[]) => { printed.push(args.map(String).join(' ')) }
  try {
    run += 1
    await import(`../scripts/analytics-maintenance.ts?case=${run}`)
  } finally {
    console.log = original
  }
  // The logger prints JSON lines too; the result is the one with the job's fields.
  const line = printed.find(text => text.startsWith('{') && text.includes('"scheduler"'))
  assert.ok(line, 'the script printed no JSON result')
  return JSON.parse(line) as Record<string, unknown>
}

test('analytics failed and the database is down: the purge is still attempted, its error reported, the pool closed', async () => {
  state.analyticsStatus = 'failed'
  state.retentionCalls = 0
  state.closeDbCalls = 0
  state.pool = downPool
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
  state.analyticsStatus = 'failed'
  state.closeDbCalls = 0
  state.pool = healthyPool(1234)
  try {
    const output = await runScript()
    assert.deepEqual(output.rateLimits, { ran: true, purged: 1234, bounded: false })
    assert.equal(state.closeDbCalls, 1)
  } finally {
    process.exitCode = 0
  }
})

test('a healthy run reports the purge and does not fail the job', async () => {
  state.analyticsStatus = 'success'
  state.retentionCalls = 0
  state.pool = healthyPool(0)
  try {
    const output = await runScript()
    assert.deepEqual(output.rateLimits, { ran: true, purged: 0, bounded: false })
    assert.equal(state.retentionCalls, 1)
    assert.ok(!process.exitCode, `exit code ${process.exitCode} for a clean run`)
  } finally {
    process.exitCode = 0
  }
})
