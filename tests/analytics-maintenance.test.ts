import assert from 'node:assert/strict'
import test from 'node:test'
import { capAggregateBuckets, normalizeAggregatePath, shiftUtcDay, utcDay } from '../server/services/analytics-maintenance'

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
