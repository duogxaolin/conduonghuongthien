import assert from 'node:assert/strict'
import test from 'node:test'
import {
  requiredAnalyticsColumnMigrations,
  realtimeAnalyticsRequiredColumnMigrations,
  realtimeAnalyticsIndexMigrations,
} from '../server/db/init'
import {
  ANALYTICS_RETENTION_BOUNDS,
  ANALYTICS_RETENTION_DEFAULTS,
  parseBoundedAnalyticsInteger,
  resolveAnalyticsRetentionConfig,
} from '../server/utils/analytics-config'

test('analytics migration plan covers every required existing-table column safely', () => {
  const keys = requiredAnalyticsColumnMigrations.map(({ table, column }) => `${table}.${column}`)
  assert.equal(new Set(keys).size, keys.length)
  for (const migration of requiredAnalyticsColumnMigrations) {
    assert.match(migration.nullableDefinition, / NULL(?:$| )/i)
    assert.match(migration.finalDefinition, / NOT NULL/i)
    assert.notEqual(migration.backfillExpression.trim(), '')
  }
  assert.deepEqual(keys, [
    'analytics_page_view_events.occurred_at',
    'analytics_page_view_events.event_day',
    'analytics_page_view_events.path',
    'analytics_page_view_events.visitor_token',
    'analytics_page_view_events.source_category',
    'analytics_page_view_events.device_class',
    'analytics_daily_traffic.page_views',
    'analytics_daily_traffic.daily_unique_visitors',
    'analytics_daily_pages.day',
    'analytics_daily_pages.path',
    'analytics_daily_pages.page_views',
    'analytics_daily_pages.daily_unique_visitors',
    'analytics_daily_dimensions.day',
    'analytics_daily_dimensions.dimension',
    'analytics_daily_dimensions.value',
    'analytics_daily_dimensions.page_views',
    'analytics_daily_dimensions.daily_unique_visitors',
    'analytics_daily_admin_users.total_users',
    'analytics_daily_admin_users.active_users',
    'analytics_maintenance_runs.status',
    'analytics_maintenance_runs.started_at',
    'analytics_maintenance_runs.event_count',
  ])
})

test('realtime retention configuration has fixed safe defaults and rejects out-of-range values', () => {
  assert.deepEqual(ANALYTICS_RETENTION_DEFAULTS, { liveRetentionHours: 48, nocRetentionDays: 30 })
  assert.deepEqual(ANALYTICS_RETENTION_BOUNDS, {
    liveRetentionHours: { min: 24, max: 168 },
    nocRetentionDays: { min: 7, max: 90 },
  })
  assert.deepEqual(resolveAnalyticsRetentionConfig({}), { liveRetentionHours: 48, nocRetentionDays: 30 })
  assert.deepEqual(resolveAnalyticsRetentionConfig({ ANALYTICS_LIVE_RETENTION_HOURS: '24', ANALYTICS_NOC_RETENTION_DAYS: '90' }), { liveRetentionHours: 24, nocRetentionDays: 90 })
  assert.throws(() => parseBoundedAnalyticsInteger('LIVE', '23', 48, 24, 168), /between 24 and 168/)
  assert.throws(() => parseBoundedAnalyticsInteger('NOC', '91', 30, 7, 90), /between 7 and 90/)
})

test('realtime DDL migration plan is deterministic and time-first indexed', () => {
  const keys = realtimeAnalyticsRequiredColumnMigrations.map(({ table, column }) => `${table}.${column}`)
  assert.equal(new Set(keys).size, keys.length)
  assert.ok(keys.some(key => key === 'analytics_live_minute_buckets.bucket_start'))
  assert.ok(keys.some(key => key === 'analytics_live_deduplication.visitor_token'))
  assert.ok(keys.some(key => key === 'analytics_noc_minute_aggregates.details_json') === false)
  for (const migration of realtimeAnalyticsRequiredColumnMigrations) {
    assert.match(migration.nullableDefinition, / NULL(?:$| )/i)
    assert.match(migration.finalDefinition, / NOT NULL/i)
    assert.notEqual(migration.backfillExpression.trim(), '')
  }
  assert.deepEqual(realtimeAnalyticsIndexMigrations.map(([, name]) => name), [
    'analytics_live_bucket_scope_value_idx',
    'analytics_live_bucket_scope_views_idx',
    'analytics_live_dedup_bucket_scope_visitor_idx',
    'analytics_live_dedup_bucket_idx',
    'analytics_noc_bucket_identity_idx',
    'analytics_noc_bucket_severity_idx',
  ])
  for (const [, , definition] of realtimeAnalyticsIndexMigrations) assert.match(definition, /`(bucket_start)`/)
})

test('legacy visitor backfill is deterministic and stores only a fixed pseudonymous token', () => {
  const migration = requiredAnalyticsColumnMigrations.find(({ column }) => column === 'visitor_token')!
  assert.match(migration.backfillExpression, /SHA2/i)
  assert.match(migration.backfillExpression, /id/i)
  assert.doesNotMatch(migration.backfillExpression, /ip|user.?agent|header/i)
})
