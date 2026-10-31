/**
 * Wave 3 D-FETCH, lot H: `/admin/analytics` — the historical report `pages/admin/analytics.vue`
 * (2 `$fetch` casts) and the real-time panel `components/admin/AnalyticsLiveDashboard.client.vue`
 * (3) — call `adminFetch<T>()` with `AnalyticsSummaryResponse` / `AnalyticsDrillDownResponse` /
 * `AnalyticsLiveResponse` / `AnalyticsBreakdownResponse` / `AnalyticsNocResponse`
 * (app/types/admin-dashboard-api.ts), derived from the handlers.
 *
 * Neither file had a behaviour test: tests/analytics-live-dashboard-ui.test.ts reads their source
 * (and runs `normalizeFilter` through `Function()`). Here both are MOUNTED (tests/_admin-page-harness.ts)
 * over REAL ofetch on a fake network that answers like `server/api/admin/analytics/**`. The live
 * panel is mounted as the browser build (`import.meta.client`), its three pollers real
 * (app/utils/analytics-live-polling.ts) — their timers are real too, stopped by the unmount.
 *
 * Pinned, green on the base (a7f312c1) and after, no finding:
 *   - report: the summary and ranking GETs (range, 10 per page, `path` for pages / `filter` for a
 *     dimension), each with its own abort signal — a newer load cancels the older and its answer
 *     is dropped, leaving the page cancels both; the totals and rows; 403 → its own sentence, else
 *     the server's (a dropped connection the fallback, never ofetch's line);
 *   - live: the three GETs (`window=60`; breakdown `scope`/`limit=10`/`value`; NOC `limit=50`) with
 *     the poller's signal; what each panel shows; changing the scope or filtering asks again and
 *     writes the URL; a 403 stops that panel with its sentence, a 500 shows the component's own
 *     "Yêu cầu thất bại (500)" (its local `errorMessage`, kept); unmounting aborts what is in flight.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import * as Vue from 'vue'

import { click, findAll, fire, input, textOf } from './_sfc-mount.ts'
import {
  alertText, dropped, h3Error, json, mountAdminPage, OFETCH_LINE, routes, settle, unmountAll, wire,
  type MountedAdminPage, type NetCall,
} from './_admin-page-harness.ts'
import { isAbortError } from '../app/utils/errorMessage.ts'
import { useAnalyticsNocTable } from '../app/composables/useAnalyticsNocTable.ts'
import * as noc from '../app/utils/analytics-noc.ts'

afterEach(unmountAll)

type Route = (call: NetCall) => Response | Error | undefined

// ─── pages/admin/analytics.vue ───────────────────────────────────────────────

const PAGE = 'pages/admin/analytics.vue'
const RANGE = { start: '2024-01-01', end: '2024-01-31' }
const summary = (pageViews: number) => json({
  ok: true, range: { ...RANGE, days: 31 },
  totals: { pageViews, summedDailyUniqueVisitors: 456, uniqueVisitorSemantics: 'summed_daily_uniques' },
  traffic: [{ day: '2024-01-01', pageViews: 10, dailyUniqueVisitors: 5 }],
  adminUsers: { snapshotDay: '2024-01-31', totalUsers: 9, activeUsers: 4 },
  freshness: { lastAggregatedDay: '2024-01-31', stale: false },
})
const drill = (values: string[]) => json({
  ok: true, range: { ...RANGE, days: 31 },
  items: values.map((value, i) => ({ value, pageViews: 100 - i, summedDailyUniqueVisitors: 50 - i })),
  pagination: { page: 1, perPage: 10, total: values.length, totalPages: 1 },
})
function report(overrides: Record<string, Route> = {}) {
  return mountAdminPage(PAGE, routes({
    'GET /api/admin/analytics/summary': () => summary(1234),
    'GET /api/admin/analytics/pages': () => drill(['/tin-tuc', 'other']),
    'GET /api/admin/analytics/dimensions/device_class': () => drill(['desktop', 'mobile']),
    ...overrides,
  }), { route: { query: { ...RANGE } }, auto: { isAbortError } })
}
const Q = `start=${RANGE.start}&end=${RANGE.end}`
const reportCalls = (opened: MountedAdminPage, from = 0) => opened.calls.slice(from).filter(c => c.url.pathname.startsWith('/api/admin/analytics/')).map(wire)
const rankingRows = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'th' && el.props.scope === 'row').map(textOf)

describe(PAGE, () => {
  it('mounting reads the summary and the page ranking for the range, each with its own signal; the totals and the rows', async () => {
    const opened = await report()
    assert.deepEqual(reportCalls(opened), [`GET /api/admin/analytics/summary?${Q}`, `GET /api/admin/analytics/pages?${Q}&perPage=10`])
    assert.ok(opened.calls.every(c => c.signal instanceof AbortSignal), 'every request carries an abort signal')
    assert.notEqual(opened.calls[0]!.signal, opened.calls[1]!.signal)
    const text = textOf(opened.page.root)
    assert.match(text, /Lượt xem trang\s*1\.234/)
    assert.match(text, /Tổng khách duy nhất theo ngày\s*456/)
    assert.match(text, /4 \/ 9/)
    assert.deepEqual(rankingRows(opened), ['/tin-tuc', 'Khác (đã gộp)'])
    assert.equal(alertText(opened.page), '')
  })

  it('filtering a page asks with `path`; a dimension asks its endpoint, and filtering it with `filter`; both written to the URL', async () => {
    const opened = await report()
    let before = opened.calls.length
    await click(findAll(opened.page.root, el => el.tag === 'button' && textOf(el) === 'Lọc giá trị')[0]!)
    await settle()
    assert.deepEqual(reportCalls(opened, before), [`GET /api/admin/analytics/pages?${Q}&perPage=10&path=%2Ftin-tuc`])
    assert.deepEqual(opened.pushes.at(-1), { query: { ...RANGE, view: 'pages', value: '/tin-tuc' } })

    await click(findAll(opened.page.root, el => el.tag === 'button' && textOf(el).includes('Quay lại') && !textOf(el).includes('khoảng'))[0]!)
    await settle()
    const select = findAll(opened.page.root, el => el.tag === 'select')[0]!
    await input(select, 'device_class')
    before = opened.calls.length
    void fire(select, 'change')
    await settle()
    assert.deepEqual(reportCalls(opened, before), [`GET /api/admin/analytics/dimensions/device_class?${Q}&perPage=10`])
    assert.deepEqual(rankingRows(opened), ['desktop', 'mobile'])
    before = opened.calls.length
    await click(findAll(opened.page.root, el => el.tag === 'button' && textOf(el) === 'Lọc giá trị')[0]!)
    await settle()
    assert.deepEqual(reportCalls(opened, before), [`GET /api/admin/analytics/dimensions/device_class?${Q}&perPage=10&filter=desktop`])
  })

  it('failures: 403 → its own sentence; another refusal → the server\'s; dropped → the fallback, never ofetch\'s line; a ranking failure with "Thử lại"', async () => {
    const denied = await report({ 'GET /api/admin/analytics/summary': () => h3Error(403, 'Forbidden') })
    assert.match(alertText(denied.page), /Bạn không có quyền xem dữ liệu phân tích\./)

    const refused = await report({ 'GET /api/admin/analytics/summary': () => h3Error(400, 'Khoảng thời gian tối đa là 366 ngày.') })
    assert.match(alertText(refused.page), /Khoảng thời gian tối đa là 366 ngày\./)

    const dead = await report({ 'GET /api/admin/analytics/summary': () => dropped() })
    assert.match(alertText(dead.page), /Không thể tải dữ liệu phân tích\. Vui lòng thử lại\./)
    assert.doesNotMatch(alertText(dead.page), OFETCH_LINE)

    let fail = true
    const ranking = await report({ 'GET /api/admin/analytics/pages': () => (fail ? h3Error(503, 'Cơ sở dữ liệu tạm thời không khả dụng.') : drill(['/lien-he'])) })
    assert.match(alertText(ranking.page), /Cơ sở dữ liệu tạm thời không khả dụng\./)
    fail = false
    await click(findAll(ranking.page.root, el => el.tag === 'button' && textOf(el) === 'Thử lại')[0]!)
    await settle()
    assert.deepEqual(rankingRows(ranking), ['/lien-he'])
  })

  it('a newer load aborts the older and drops its answer; leaving the page aborts what is in flight', async () => {
    const held: NetCall[] = []
    let hold = false
    const opened = await report({ 'GET /api/admin/analytics/summary': (call) => { if (!hold) return summary(1234); held.push(call); return undefined } })
    hold = true
    const presets = findAll(opened.page.root, el => el.tag === 'button' && /^(7 ngày|30 ngày)$/.test(textOf(el)))
    void click(presets[0]!)
    await settle()
    void click(presets[1]!)
    await settle()
    assert.equal(held.length, 2)
    assert.equal(held[0]!.signal?.aborted, true, 'the older summary request was aborted')
    assert.equal(held[1]!.signal?.aborted, false)
    held[1]!.respond(summary(30))
    await settle()
    held[0]!.respond(summary(7))
    await settle()
    assert.match(textOf(opened.page.root), /Lượt xem trang\s*30(?!\d)/)

    void click(presets[0]!)
    await settle()
    opened.page.unmount()
    assert.equal(held[2]!.signal?.aborted, true, 'leaving the page aborts the summary in flight')
  })
})

// ─── components/admin/AnalyticsLiveDashboard.client.vue ─────────────────────

const LIVE = 'components/admin/AnalyticsLiveDashboard.client.vue'
const META = { generatedAt: '2026-10-20T02:01:00.000Z', latestBucketStart: '2026-10-20T02:00:00.000Z', nextPollAfterSeconds: 15, freshness: 'current', stale: false }
const live = () => json({
  ok: true, windowMinutes: 60, ...META,
  points: [{ bucketStart: '2026-10-20T02:00:00.000Z', pageViews: 7, approximateUniqueVisitors: 3, uniqueVisitorSemantics: 'approximate_minute_token' }],
  fiveMinuteTotals: { pageViews: 7, approximateUniqueVisitors: 3, eventsPerMinute: 1.4, uniqueVisitorSemantics: 'approximate_minute_token' },
})
const breakdown = (scope: string, value: string) => json({
  ok: true, scope, windowMinutes: 60, totalPageViews: 7, ...META,
  rows: [{ rank: 1, value, pageViews: 5, approximateUniqueVisitors: 2, share: 0.71, uniqueVisitorSemantics: 'approximate_minute_token' }],
})
const nocAnswer = () => json({
  ok: true, nextCursor: null, ...META,
  rows: [{ id: 1, bucketStart: '2026-10-20T02:00:00.000Z', eventType: 'db_slow_query', severity: 'warning', component: 'mysql', status: 'open', errorCode: 'E_SLOW', eventCount: 3, duration: { count: 3, averageMs: 120, maxMs: 300 }, details: null }],
})
const LIVE_ROUTES: Record<string, Route> = {
  'GET /api/admin/analytics/live': () => live(),
  'GET /api/admin/analytics/live/breakdown': call => breakdown(call.url.searchParams.get('scope')!, call.url.searchParams.get('scope') === 'path' ? '/tin-tuc' : 'desktop'),
  'GET /api/admin/analytics/noc': () => nocAnswer(),
}
function dashboard(overrides: Record<string, Route> = {}) {
  const doc = { hidden: false, addEventListener() {}, removeEventListener() {} }
  return mountAdminPage(LIVE, routes({ ...LIVE_ROUTES, ...overrides }), {
    importMeta: { server: false, client: true },
    auto: { shallowRef: Vue.shallowRef, useAnalyticsNocTable, ...noc, document: doc },
  })
}
const liveCalls = (opened: MountedAdminPage, from = 0) => opened.calls.slice(from).map(wire)
const alertsText = (opened: MountedAdminPage) => alertText(opened.page)

describe(LIVE, () => {
  it('mounting starts three pollers: live (window=60), breakdown (path, limit 10), NOC (limit 50), each with the poller\'s signal; what each panel shows', async () => {
    const opened = await dashboard()
    assert.deepEqual(liveCalls(opened).sort(), [
      'GET /api/admin/analytics/live/breakdown?scope=path&window=60&limit=10',
      'GET /api/admin/analytics/live?window=60',
      'GET /api/admin/analytics/noc?limit=50',
    ])
    assert.ok(opened.calls.every(c => c.signal instanceof AbortSignal))
    const text = textOf(opened.page.root)
    assert.match(text, /Lượt xem \(5 phút\)\s*7/)
    assert.match(text, /\/tin-tuc/)
    assert.match(text, /db_slow_query|E_SLOW/)
    assert.equal(alertsText(opened), '')
  })

  it('changing the scope asks the breakdown again (and writes `liveScope`); filtering a row adds `value`', async () => {
    const opened = await dashboard()
    let before = opened.calls.length
    await click(findAll(opened.page.root, el => el.tag === 'button' && textOf(el) === 'Thiết bị')[0]!)
    await settle()
    assert.deepEqual(liveCalls(opened, before), ['GET /api/admin/analytics/live/breakdown?scope=device_class&window=60&limit=10'])
    assert.deepEqual(opened.pushes.at(-1), { query: { liveScope: 'device_class' } })
    before = opened.calls.length
    await click(findAll(opened.page.root, el => el.tag === 'button' && textOf(el).trim() === 'Lọc')[0]!)
    await settle()
    assert.deepEqual(liveCalls(opened, before), ['GET /api/admin/analytics/live/breakdown?scope=device_class&window=60&limit=10&value=desktop'])
    assert.deepEqual(opened.pushes.at(-1), { query: { liveScope: 'device_class', liveFilter: 'desktop' } })
  })

  it('a 403 stops that panel ("Không có quyền truy cập.", the banner); a 500 shows the component\'s own "Yêu cầu thất bại (500)"; the other panels still show', async () => {
    const opened = await dashboard({
      'GET /api/admin/analytics/noc': () => h3Error(403, 'Forbidden'),
      'GET /api/admin/analytics/live': () => h3Error(500, 'Internal Server Error'),
    })
    const screen = textOf(opened.page.root)
    assert.match(screen, /Từ chối truy cập\.\s*Một bảng bị từ chối quyền truy cập; các bảng còn lại vẫn hoạt động\./)
    assert.match(screen, /Không có quyền truy cập\./)
    assert.match(alertsText(opened), /Yêu cầu thất bại \(500\)/)
    assert.doesNotMatch(alertsText(opened), OFETCH_LINE)
    assert.match(screen, /\/tin-tuc/)
    const nocCalls = opened.calls.filter(c => c.url.pathname === '/api/admin/analytics/noc').length
    assert.equal(nocCalls, 1, 'a denied panel is not asked again (ofetch does not retry a 403)')
  })

  it('unmounting aborts the requests in flight', async () => {
    const held: NetCall[] = []
    const hold: Route = (call) => { held.push(call); return undefined }
    const opened = await dashboard({ 'GET /api/admin/analytics/live': hold, 'GET /api/admin/analytics/live/breakdown': hold, 'GET /api/admin/analytics/noc': hold })
    assert.equal(held.length, 3)
    assert.ok(held.every(c => c.signal?.aborted === false))
    opened.page.unmount()
    assert.ok(held.every(c => c.signal?.aborted === true), 'every poller aborted its request')
  })
})
