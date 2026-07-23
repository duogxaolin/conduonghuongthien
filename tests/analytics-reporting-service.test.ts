import assert from 'node:assert/strict'
import test from 'node:test'
import { getAnalyticsDimension, getAnalyticsPages, getAnalyticsSummary, type ReportingConnection } from '../server/services/analytics-reporting'

const range = { start: '2026-07-01', end: '2026-07-03', days: 3 }

function fakeConnection(responses: unknown[][], statements: string[] = []): ReportingConnection {
  let index = 0
  return {
    async query(sql: string) {
      statements.push(sql)
      return [responses[index++] || [], []] as any
    },
  } as ReportingConnection
}

test('summary returns aggregate totals, summed daily uniques, snapshot, and freshness', async () => {
  const statements: string[] = []
  const result = await getAnalyticsSummary(range, {
    connection: fakeConnection([
      [
        { day: '2026-07-01', page_views: 10, daily_unique_visitors: 7 },
        { day: '2026-07-02', page_views: 5, daily_unique_visitors: 4 },
      ],
      [{ day: '2026-07-02', total_users: 8, active_users: 6 }],
      [{ last_aggregated_day: '2026-07-02' }],
    ], statements),
    now: new Date('2026-07-03T12:00:00Z'),
    freshnessThresholdHours: 48,
  })
  assert.equal(result.totals.pageViews, 15)
  assert.equal(result.totals.summedDailyUniqueVisitors, 11)
  assert.equal(result.totals.uniqueVisitorSemantics, 'summed_daily_uniques')
  assert.deepEqual(result.adminUsers, { snapshotDay: '2026-07-02', totalUsers: 8, activeUsers: 6 })
  assert.equal(result.freshness.stale, false)
  assert.ok(statements.every(sql => !sql.includes('analytics_page_view_events')))
  assert.doesNotMatch(JSON.stringify(result), /visitor_token|visitorToken|ip|userAgent/i)
})

test('summary returns stable empty and stale state', async () => {
  const result = await getAnalyticsSummary(range, {
    connection: fakeConnection([[], [], [{ last_aggregated_day: null }]]),
    now: new Date('2026-07-03T12:00:00Z'),
  })
  assert.deepEqual(result.traffic, [])
  assert.deepEqual(result.totals, { pageViews: 0, summedDailyUniqueVisitors: 0, uniqueVisitorSemantics: 'summed_daily_uniques' })
  assert.equal(result.adminUsers, null)
  assert.deepEqual(result.freshness, { lastAggregatedDay: null, stale: true })
})

test('drill-down ranks aggregate rows and keeps other stable', async () => {
  const pages = await getAnalyticsPages(range, {
    connection: fakeConnection([[{ total: 3 }], [
      { value: '/news', page_views: 12, summed_daily_unique_visitors: 9 },
      { value: 'other', page_views: 20, summed_daily_unique_visitors: 14 },
    ]]),
    page: 1,
    perPage: 2,
    path: null,
  })
  assert.deepEqual(pages.pagination, { page: 1, perPage: 2, total: 3, totalPages: 2 })
  assert.deepEqual(pages.items.map(row => row.value), ['/news', 'other'])

  const dimensions = await getAnalyticsDimension(range, {
    connection: fakeConnection([[{ total: 1 }], [{ value: 'mobile', page_views: 5, summed_daily_unique_visitors: 4 }]]),
    page: 1,
    perPage: 20,
    dimension: 'device_class',
    filter: 'mobile',
  })
  assert.equal(dimensions.items[0].value, 'mobile')
})
