import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getAnalyticsLiveBreakdown,
  getAnalyticsLiveSummary,
  getAnalyticsNocReport,
  type ReportingConnection,
} from '../server/services/analytics-reporting'
import { encodeAnalyticsNocCursor, parseAnalyticsNocCursor } from '../server/utils/analytics-reporting'

function fakeConnection(responses: unknown[][], statements: string[] = [], params: unknown[][] = []): ReportingConnection {
  let index = 0
  return {
    async query(sql: string, values?: unknown[]) {
      statements.push(sql)
      params.push(values || [])
      return [responses[index++] || [], []] as any
    },
  } as ReportingConnection
}

const prohibitedSql = /analytics_page_view_events|analytics_live_deduplication|visitor_token|dedupe/i
const prohibitedResponse = /visitorToken|visitor_token|dedupe|queryString|referrer|userAgent|cookie|requestBody|rawPayload|stackTrace|sqlText|ipAddress/i

test('live summary returns at most 60 completed UTC points and five-minute approximate totals', async () => {
  const statements: string[] = []
  const params: unknown[][] = []
  const result = await getAnalyticsLiveSummary(60, {
    connection: fakeConnection([[
      { bucket_start: '2026-07-22 11:57:00', page_views: 4, approximate_unique_visitors: 3 },
      { bucket_start: '2026-07-22 11:59:00', page_views: 2, approximate_unique_visitors: 2 },
    ]], statements, params),
    now: new Date('2026-07-22T12:00:30Z'),
  })
  assert.equal(result.points.length, 60)
  assert.equal(result.points.at(-1)?.bucketStart, '2026-07-22T11:59:00.000Z')
  assert.deepEqual(result.points.slice(-3).map(point => [point.bucketStart, point.pageViews]), [
    ['2026-07-22T11:57:00.000Z', 4],
    ['2026-07-22T11:58:00.000Z', 0],
    ['2026-07-22T11:59:00.000Z', 2],
  ])
  assert.deepEqual(result.fiveMinuteTotals, {
    pageViews: 6,
    approximateUniqueVisitors: 5,
    eventsPerMinute: 1.2,
    uniqueVisitorSemantics: 'approximate_minute_token',
  })
  assert.equal(result.meta.freshness, 'current')
  assert.equal(result.meta.nextPollAfterSeconds, 15)
  assert.equal((params[0][1] as Date).toISOString(), '2026-07-22T12:00:00.000Z')
  assert.ok(statements.every(sql => !prohibitedSql.test(sql)))
  assert.doesNotMatch(JSON.stringify(result), prohibitedResponse)
})

test('live summary preserves explicit empty and stale states', async () => {
  const empty = await getAnalyticsLiveSummary(60, {
    connection: fakeConnection([[]]),
    now: new Date('2026-07-22T12:00:30Z'),
  })
  assert.deepEqual(empty.points, [])
  assert.equal(empty.meta.freshness, 'empty')
  assert.equal(empty.meta.latestBucketStart, null)

  const stale = await getAnalyticsLiveSummary(5, {
    connection: fakeConnection([[
      { bucket_start: '2026-07-22 11:55:00', page_views: 1, approximate_unique_visitors: 1 },
      { bucket_start: '2026-07-22 11:57:00', page_views: 2, approximate_unique_visitors: 2 },
    ]]),
    now: new Date('2026-07-22T12:00:30Z'),
  })
  assert.equal(stale.meta.freshness, 'stale')
  assert.equal(stale.meta.stale, true)
  assert.deepEqual(stale.points.map(point => [point.bucketStart, point.pageViews]), [
    ['2026-07-22T11:55:00.000Z', 1],
    ['2026-07-22T11:56:00.000Z', 0],
    ['2026-07-22T11:57:00.000Z', 2],
  ])
  assert.equal(stale.points.some(point => point.bucketStart === '2026-07-22T11:58:00.000Z'), false)
  assert.equal(stale.points.some(point => point.bucketStart === '2026-07-22T11:59:00.000Z'), false)
  assert.deepEqual(stale.fiveMinuteTotals, {
    pageViews: 3,
    approximateUniqueVisitors: 3,
    eventsPerMinute: 0.6,
    uniqueVisitorSemantics: 'approximate_minute_token',
  })
})

test('breakdown uses bounded live aggregates, total-window shares, normalized values, and top cap', async () => {
  const statements: string[] = []
  const params: unknown[][] = []
  const result = await getAnalyticsLiveBreakdown('path', 15, {
    connection: fakeConnection([
      [{ total_page_views: 20, latest_bucket_start: '2026-07-22 11:59:00' }],
      [
        { scope_value: '/news', page_views: 12, approximate_unique_visitors: 8 },
        { scope_value: '/about', page_views: 5, approximate_unique_visitors: 4 },
      ],
    ], statements, params),
    now: new Date('2026-07-22T12:00:30Z'),
    limit: 50,
  })
  assert.deepEqual(result.rows.map(row => [row.rank, row.value, row.share]), [[1, '/news', 0.6], [2, '/about', 0.25]])
  assert.equal(params[1].at(-1), 50)
  assert.match(statements[1], /GROUP BY scope_value[\s\S]*LIMIT \?/)
  assert.ok(statements.every(sql => !prohibitedSql.test(sql)))
  assert.doesNotMatch(JSON.stringify(result), prohibitedResponse)
})

test('NOC report projects allowlisted safe fields with stable newest-first cursor', async () => {
  const statements: string[] = []
  const now = new Date('2026-07-22T12:00:30Z')
  const result = await getAnalyticsNocReport({
    connection: fakeConnection([[
      { id: 11, bucket_start: '2026-07-22 11:59:00', event_type: 'reporting_failure', severity: 'error', component: 'reporting', status: 'failure', error_code: 'query_failed', event_count: 2, duration_count: 2, duration_total_ms: 25, duration_max_ms: 20, details_json: '{"reasonCode":"query_failed","windowMinutes":60}' },
      { id: 10, bucket_start: '2026-07-22 11:58:00', event_type: 'reporting_success', severity: 'info', component: 'reporting', status: 'success', error_code: 'none', event_count: 3, duration_count: 0, duration_total_ms: 0, duration_max_ms: 0, details_json: '{"rowCount":10,"windowMinutes":60,"cookie":"secret"}' },
    ]], statements),
    now,
    limit: 1,
  })
  assert.equal(result.rows.length, 1)
  assert.deepEqual(result.rows[0].duration, { count: 2, averageMs: 13, maxMs: 20 })
  assert.deepEqual(result.rows[0].details, { reasonCode: 'query_failed', windowMinutes: 60 })
  assert.ok(result.nextCursor)
  assert.deepEqual(parseAnalyticsNocCursor(result.nextCursor), { bucketStart: new Date('2026-07-22T11:59:00Z'), id: 11 })
  assert.match(statements[0], /ORDER BY bucket_start DESC, id DESC[\s\S]*LIMIT \?/)
  assert.ok(statements.every(sql => !prohibitedSql.test(sql)))
  assert.doesNotMatch(JSON.stringify(result), prohibitedResponse)
})

test('opaque NOC cursors round-trip and reject malformed values', () => {
  const cursor = { bucketStart: new Date('2026-07-22T11:59:00.000Z'), id: 55 }
  assert.deepEqual(parseAnalyticsNocCursor(encodeAnalyticsNocCursor(cursor)), cursor)
  for (const invalid of ['%%%', Buffer.from('{}').toString('base64url'), Buffer.from(JSON.stringify(['bad', 0])).toString('base64url')]) {
    assert.throws(() => parseAnalyticsNocCursor(invalid), (error: any) => error.statusCode === 400)
  }
})
