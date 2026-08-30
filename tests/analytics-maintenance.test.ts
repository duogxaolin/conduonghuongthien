import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { capAggregateBuckets, normalizeAggregatePath, shiftUtcDay, utcDay } from '../server/services/analytics-maintenance'

const read = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')

test('normalizes paths without query strings or fragments', () => {
  assert.equal(normalizeAggregatePath('/news/local?campaign=secret#section'), '/news/local')
  assert.equal(normalizeAggregatePath('not-a-route'), '/other')
})

test('shifts UTC days across month and year boundaries', () => {
  assert.equal(shiftUtcDay('2026-01-01', -1), '2025-12-31')
  assert.equal(shiftUtcDay('2024-03-01', -1), '2024-02-29')
  assert.equal(utcDay(new Date('2026-07-22T23:59:59Z')), '2026-07-22')
})

test('caps dimensions deterministically and preserves excess totals in other', () => {
  const result = capAggregateBuckets([
    { value: 'z', pageViews: 2, visitorTokens: new Set(['z']) },
    { value: 'a', pageViews: 2, visitorTokens: new Set(['a']) },
    { value: 'b', pageViews: 1, visitorTokens: new Set(['b']) },
  ], 2)
  assert.deepEqual(result.map(row => row.value), ['a', 'other'])
  assert.equal(result[1].pageViews, 3)
  assert.deepEqual([...result[1].visitorTokens].sort(), ['b', 'z'])
})

test('merges an existing other bucket with page overflow without duplicate rows', () => {
  const input = [
    { value: '/news', pageViews: 8, visitorTokens: new Set(['shared', 'news']) },
    { value: '/about', pageViews: 4, visitorTokens: new Set(['about']) },
    { value: 'other', pageViews: 3, visitorTokens: new Set(['shared', 'existing']) },
  ]
  const result = capAggregateBuckets(input, 2)
  assert.deepEqual(result.map(row => row.value), ['/news', 'other'])
  assert.equal(result.reduce((sum, row) => sum + row.pageViews, 0), 15)
  assert.equal(result[1].pageViews, 7)
  assert.deepEqual([...result[1].visitorTokens].sort(), ['about', 'existing', 'shared'])
})

test('merges an existing other dimension value even when it ranks above named values', () => {
  const result = capAggregateBuckets([
    { value: 'other', pageViews: 20, visitorTokens: new Set(['existing', 'shared']) },
    { value: 'mobile', pageViews: 10, visitorTokens: new Set(['mobile', 'shared']) },
    { value: 'desktop', pageViews: 5, visitorTokens: new Set(['desktop']) },
  ], 2)
  assert.deepEqual(result.map(row => row.value), ['mobile', 'other'])
  assert.equal(result.reduce((sum, row) => sum + row.pageViews, 0), 35)
  assert.equal(result[1].visitorTokens.size, 3)
  assert.deepEqual([...result[1].visitorTokens].sort(), ['desktop', 'existing', 'shared'])
})

test('aggregateDay upserts admin_user snapshot instead of insert — daily PRIMARY KEY is `day`', () => {
  // `analytics_daily_admin_users` uses `day` as its PRIMARY KEY (init.ts:718 —
  // `` `day` DATE PRIMARY KEY ``, no surrogate `id`). The three sibling aggregate
  // tables (dimensions/pages/traffic) are DELETE-then-INSERT per day, so they are
  // idempotent across re-runs. This one is NOT deleted first, so the INSERT must
  // carry `ON DUPLICATE KEY UPDATE` — otherwise re-aggregating the same `day`
  // (backfill, retry, a stale-run catch-up) throws `Duplicate entry '<day>' for key
  // 'analytics_daily_admin_users.PRIMARY'` and rolls back the whole per-day
  // transaction, which rolls back the minute-bucket aggregation too. That is the bug
  // that emptied the live dashboard: maintenance failed every night for the same
  // reason while the raw rows kept accumulating.
  //
  // Pinned on the SQL string (not behaviour) because the failure only surfaces on a
  // real driver with a populated row — `aggregateDay` runs inside a transaction with
  // a real pool connection, and a source-text guard is the only layer below the
  // integration suite. The adjacent INSERT into `analytics_maintenance_runs` (line
  // 176) already upserts; this one had drifted to plain INSERT.
  const source = read('server/services/analytics-maintenance.ts')
  // The statement is a template literal spanning two lines; the upsert clause sits
  // *after* VALUES (?, ?, ?), so match through to the second `active_users)` (the
  // one closing the VALUE list) to capture it.
  const insert = source.match(/INSERT INTO analytics_daily_admin_users[\s\S]*?VALUES\(active_users\)/)
  assert.ok(insert, 'the admin-user snapshot INSERT must be present')
  assert.match(insert[0].replace(/\s+/g, ' '), /ON DUPLICATE KEY UPDATE/i,
    'aggregateDay must ON DUPLICATE KEY UPDATE analytics_daily_admin_users — `day` is the PRIMARY KEY')
  assert.match(insert[0].replace(/\s+/g, ' '), /total_users\s*=\s*VALUES\(total_users\)/i,
    'the upsert must refresh total_users')
  assert.match(insert[0].replace(/\s+/g, ' '), /active_users\s*=\s*VALUES\(active_users\)/i,
    'the upsert must refresh active_users')
})
