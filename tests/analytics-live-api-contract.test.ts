import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import {
  ANALYTICS_BREAKDOWN_ROW_CAP,
  ANALYTICS_NOC_ROW_CAP,
  parseAnalyticsBreakdownScope,
  parseAnalyticsLiveWindow,
  parseAnalyticsNocLimit,
  requireAnalyticsRead,
} from '../server/utils/analytics-reporting'

const root = new URL('../server/api/admin/analytics/', import.meta.url)
const routes = ['live.get.ts', 'live/breakdown.get.ts', 'noc.get.ts']

test('every realtime reporting route explicitly calls analytics read guard and serializes a closed response', async () => {
  for (const route of routes) {
    const source = await readFile(new URL(route, root), 'utf8')
    assert.match(source, /requireAnalyticsRead\(event\)/)
    assert.match(source, /return \{\s*ok: true,/)
    assert.doesNotMatch(source, /\.\.\.report|analytics_page_view_events|analytics_live_deduplication|visitor_token|requestBody|referrer|userAgent|cookie/i)
  }
})

test('every realtime reporting endpoint preserves existing 401 and 403 contracts', async () => {
  for (const route of routes) {
    const handler = (await import(new URL(route, root).href)).default
    await assert.rejects(() => handler({ context: {}, path: '/' } as any), (error: any) => error.statusCode === 401)
    await assert.rejects(
      () => handler({ context: { adminUser: { permissions: [], isSuperAdmin: false } }, path: '/' } as any),
      (error: any) => error.statusCode === 403,
    )
  }
  assert.throws(() => requireAnalyticsRead({ context: {} } as any), (error: any) => error.statusCode === 401)
})

test('realtime endpoint handlers reject malformed and over-limit query parameters before reporting', async () => {
  const adminUser = { permissions: [], isSuperAdmin: true }
  const live = (await import(new URL('live.get.ts', root).href)).default
  const breakdown = (await import(new URL('live/breakdown.get.ts', root).href)).default
  const noc = (await import(new URL('noc.get.ts', root).href)).default
  await assert.rejects(() => live({ context: { adminUser }, path: '/?window=61' } as any), (error: any) => error.statusCode === 400)
  await assert.rejects(() => breakdown({ context: { adminUser }, path: '/?scope=total&window=60&limit=10' } as any), (error: any) => error.statusCode === 400)
  await assert.rejects(() => breakdown({ context: { adminUser }, path: '/?scope=path&window=60&limit=51' } as any), (error: any) => error.statusCode === 400)
  await assert.rejects(() => noc({ context: { adminUser }, path: '/?limit=101' } as any), (error: any) => error.statusCode === 400)
  await assert.rejects(() => noc({ context: { adminUser }, path: '/?cursor=malformed' } as any), (error: any) => error.statusCode === 400)
  await assert.rejects(() => noc({ context: { adminUser }, path: '/?window=7' } as any), (error: any) => error.statusCode === 400)
})

test('scope, window, and limit parsers strictly reject unsupported and over-limit requests', () => {
  assert.equal(parseAnalyticsLiveWindow('60'), 60)
  for (const value of ['0', '14', '61', '60x', ['60']]) assert.throws(() => parseAnalyticsLiveWindow(value))
  assert.equal(parseAnalyticsBreakdownScope('path'), 'path')
  for (const scope of ['total', 'visitor_token', 'arbitrary']) assert.throws(() => parseAnalyticsBreakdownScope(scope))
  assert.equal(ANALYTICS_BREAKDOWN_ROW_CAP, 50)
  assert.equal(ANALYTICS_NOC_ROW_CAP, 100)
  assert.equal(parseAnalyticsNocLimit('100'), 100)
  assert.throws(() => parseAnalyticsNocLimit('101'))
})
