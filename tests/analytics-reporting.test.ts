import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeDimensionFilter,
  normalizePageFilter,
  parseAnalyticsDimension,
  parseAnalyticsRange,
  parsePositiveInteger,
  requireAnalyticsRead,
} from '../server/utils/analytics-reporting'

test('uses an inclusive UTC default range', () => {
  const range = parseAnalyticsRange({}, { now: new Date('2026-07-22T23:30:00Z') })
  assert.deepEqual(range, { start: '2026-06-23', end: '2026-07-22', days: 30 })
})

test('accepts one, thirty, and leap-boundary 366-day ranges', () => {
  assert.equal(parseAnalyticsRange({ start: '2026-07-22', end: '2026-07-22' }, { now: new Date('2026-07-22T00:00:00Z') }).days, 1)
  assert.equal(parseAnalyticsRange({ start: '2026-06-23', end: '2026-07-22' }, { now: new Date('2026-07-22T00:00:00Z') }).days, 30)
  assert.equal(parseAnalyticsRange({ start: '2024-02-29', end: '2025-02-28' }, { now: new Date('2025-02-28T00:00:00Z') }).days, 366)
})

test('rejects malformed, invalid, inverted, future, and excessive ranges', () => {
  for (const query of [
    { start: '2026-2-01', end: '2026-02-01' },
    { start: '2026-02-30', end: '2026-03-01' },
    { start: '2026-03-02', end: '2026-03-01' },
    { start: '2026-07-22', end: '2026-07-23' },
    { start: '2025-07-21', end: '2026-07-22' },
  ]) {
    assert.throws(() => parseAnalyticsRange(query, { now: new Date('2026-07-22T00:00:00Z') }))
  }
})

test('normalizes only allowlisted drill-down filters', () => {
  assert.equal(normalizePageFilter('/news/local?query=ignored#section'), '/news/local')
  assert.equal(normalizeDimensionFilter('source_category', ' SOCIAL '), 'social')
  assert.equal(normalizeDimensionFilter('country_code', 'us'), 'US')
  assert.throws(() => normalizeDimensionFilter('device_class', 'tablet;DROP'))
  assert.throws(() => normalizePageFilter('news/local'))
  assert.equal(parseAnalyticsDimension('device_class'), 'device_class')
  assert.throws(() => parseAnalyticsDimension('arbitrary_sql_column'))
  assert.equal(parsePositiveInteger('100', 'perPage', 20, 100), 100)
  assert.throws(() => parsePositiveInteger('101', 'perPage', 20, 100))
})

test('analytics read authorization rejects missing and unauthorized users', () => {
  assert.throws(
    () => requireAnalyticsRead({ context: {} } as any),
    (error: any) => error.statusCode === 401,
  )
  assert.throws(
    () => requireAnalyticsRead({ context: { adminUser: { permissions: [], isSuperAdmin: false } } } as any),
    (error: any) => error.statusCode === 403,
  )
})

test('analytics read authorization accepts explicit permission and superadmin', () => {
  const authorized = { permissions: [{ resource: 'analytics', canCreate: false, canRead: true, canUpdate: false, canDelete: false }], isSuperAdmin: false }
  assert.equal(requireAnalyticsRead({ context: { adminUser: authorized } } as any), authorized)
  const superadmin = { permissions: [], isSuperAdmin: true }
  assert.equal(requireAnalyticsRead({ context: { adminUser: superadmin } } as any), superadmin)
})
