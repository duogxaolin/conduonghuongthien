import assert from 'node:assert/strict'
import test from 'node:test'
import { bestEffortRecordAnalyticsNoc, recordAnalyticsNoc, type AnalyticsNocConnection } from '../server/services/analytics-noc'

function connection(query: (sql: string, values: unknown[]) => Promise<unknown>): AnalyticsNocConnection {
  return { query } as AnalyticsNocConnection
}

test('NOC persistence upserts one minute aggregate with only normalized safe values', async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = []
  await recordAnalyticsNoc({
    eventType: 'reporting_success', severity: 'info', component: 'reporting', status: 'success', errorCode: 'none',
    details: { windowMinutes: 60, rowCount: 10 }, occurredAt: new Date('2026-07-22T12:00:59Z'), durationMs: 25,
  }, connection(async (sql, values) => { calls.push({ sql, values }); return [[], []] }))
  assert.equal(calls.length, 1)
  assert.equal((calls[0].values[0] as Date).toISOString(), '2026-07-22T12:00:00.000Z')
  assert.deepEqual(calls[0].values.slice(1, 6), ['reporting_success', 'info', 'reporting', 'success', 'none'])
  assert.equal(calls[0].values.at(-1), '{"rowCount":10,"windowMinutes":60}')
  assert.doesNotMatch(JSON.stringify(calls[0].values), /visitor|cookie|referrer|query string|user agent|stack|sql text/i)
  assert.match(calls[0].sql, /ON DUPLICATE KEY UPDATE/)
})

test('best-effort NOC failure is swallowed without recursion', async () => {
  let calls = 0
  const recorded = await bestEffortRecordAnalyticsNoc({
    eventType: 'reporting_failure', severity: 'error', component: 'reporting', status: 'failure', errorCode: 'query_failed', details: { windowMinutes: 60, reasonCode: 'query_failed' },
  }, connection(async () => { calls += 1; throw new Error('storage unavailable') }))
  assert.equal(recorded, false)
  assert.equal(calls, 1)
})
