/**
 * Wave 3 D-FETCH, batch B: the admin dashboard (`pages/admin/index.vue`, 8 `$fetch` casts)
 * and the livestream page (`pages/admin/livestream/index.vue`, 6) call `adminFetch<T>()`
 * with response types derived from the handlers (app/types/admin-dashboard-api.ts,
 * admin-livestream-api.ts).
 *
 * The REAL page — `<script setup>` and template — is mounted (tests/_admin-page-harness.ts)
 * over REAL ofetch on a fake network. Pinned, green before and after the conversion:
 *   - the exact requests each page sends on mount and on each action (method, path,
 *     query, body), and the reloads after them;
 *   - a failure shows the sentence the SERVER wrote or the page's own fallback, never
 *     ofetch's `[GET] "…"` line;
 *   - the cells that format nullable values (`startedAt`, a message's `createdAt`).
 *
 * FINDINGS, each RED on the base (ea5b500):
 *   - the "Đơn đăng ký hỗ trợ — Chờ xử lý" card read `counts.new ?? submissions.length`.
 *     `counts` only has a key for a status that has rows, so with no new submission the
 *     card showed the number of ALL submissions (e.g. 12 resolved → "12" pending);
 *   - a stat request that failed (an editor without `submissions.read` gets a 403) left
 *     its card on "..." for good — the same text as "still loading";
 *   - the livestream preview `<iframe>` is shown only for a YouTube session (it has an
 *     `embedUrl`) but loaded `streamUrl`, which the server sends as '' for YouTube: the
 *     preview was always blank.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { byText, click, findAll, input, textOf, type MiniElement, type MountedSfc } from './_sfc-mount.ts'
import {
  alertText, buttons, h3Error, json, mountAdminPage, OFETCH_LINE, routes, sent, settle, unmountAll, wire,
  type MountedAdminPage, type NetCall,
} from './_admin-page-harness.ts'

function assertOnlyServerSentences(opened: MountedAdminPage) {
  for (const t of opened.toasts) assert.doesNotMatch(t.message, OFETCH_LINE, `toast "${t.message}"`)
  assert.doesNotMatch(alertText(opened.page), OFETCH_LINE)
}

// ─── pages/admin/index.vue ───────────────────────────────────────────────────

const day = (n: number) => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

const LIVE = {
  ok: true, windowMinutes: 60, points: [],
  fiveMinuteTotals: { pageViews: 1234, approximateUniqueVisitors: 56, eventsPerMinute: 2.5, uniqueVisitorSemantics: 'approximate_minute_token' },
  generatedAt: '2026-10-27T03:00:00.000Z', latestBucketStart: null, nextPollAfterSeconds: 15, freshness: 'current', stale: false,
}
const breakdown = (scope: string, rows: Array<[string, number]>) => ({
  ok: true, scope, windowMinutes: 60, totalPageViews: rows.reduce((sum, [, views]) => sum + views, 0),
  rows: rows.map(([value, pageViews], i) => ({ rank: i + 1, value, pageViews, approximateUniqueVisitors: Math.ceil(pageViews / 2), share: 0.5, uniqueVisitorSemantics: 'approximate_minute_token' })),
  generatedAt: '2026-10-27T03:00:00.000Z', latestBucketStart: null, nextPollAfterSeconds: 15, freshness: 'current', stale: false,
})
const page = (total: number) => ({ ok: true, items: [], pagination: { page: 1, perPage: 15, total, totalPages: Math.ceil(total / 15) } })

function dashboardServer(overrides: Record<string, (call: NetCall) => Response | Error> = {}) {
  return routes({
    'GET /api/admin/articles': call => json(page(call.url.searchParams.get('type') === 'role_model' ? 7 : 120)),
    'GET /api/admin/submissions': () => json({ ok: true, submissions: [{ id: 1 }, { id: 2 }, { id: 3 }], counts: { new: 2, resolved: 1 } }),
    'GET /api/admin/media': () => json(page(48)),
    'GET /api/admin/analytics/summary': () => json({ ok: true, range: {}, totals: {}, traffic: [], adminUsers: null, freshness: { lastAggregatedDay: null, stale: false } }),
    'GET /api/admin/analytics/live': () => json(LIVE),
    'GET /api/admin/analytics/live/breakdown': call => json(call.url.searchParams.get('scope') === 'device_class'
      ? breakdown('device_class', [['mobile', 30], ['desktop', 10]])
      : breakdown('source_category', [['search', 25], ['direct', 15]])),
    ...overrides,
  })
}

const DASHBOARD = 'pages/admin/index.vue'
/** The number on a stat card, found by the card's link. */
function statCard(page: MountedSfc, path: string): string {
  const card = findAll(page.root, el => el.tag === 'nuxt-link' && el.props.to === path)[0]
  if (!card) throw new Error(`no stat card linking to ${path}`)
  const value = findAll(card, el => String(el.props.class ?? '').includes('text-[2rem]'))[0]!
  return textOf(value)
}

describe('pages/admin/index.vue (dashboard)', () => {
  afterEach(unmountAll)
  it('mount: the four stat requests, then summary, live and the two breakdowns — same paths and queries as before', async () => {
    const opened = await mountAdminPage(DASHBOARD, dashboardServer())
    assert.deepEqual(opened.calls.map(wire), [
      'GET /api/admin/articles',
      'GET /api/admin/articles?type=role_model',
      'GET /api/admin/submissions',
      'GET /api/admin/media',
      `GET /api/admin/analytics/summary?start=${day(6)}&end=${day(0)}`,
      'GET /api/admin/analytics/live',
      'GET /api/admin/analytics/live/breakdown?scope=source_category&window=60',
      'GET /api/admin/analytics/live/breakdown?scope=device_class&window=60',
    ])
    opened.page.unmount()
  })

  it('stat cards show the server totals; the pending card is the count of NEW submissions', async () => {
    const opened = await mountAdminPage(DASHBOARD, dashboardServer())
    assert.equal(statCard(opened.page, '/admin/content/articles'), '120')
    assert.equal(statCard(opened.page, '/admin/content/articles?type=role_model'), '7')
    assert.equal(statCard(opened.page, '/admin/submissions?status=new'), '2')
    assert.equal(statCard(opened.page, '/admin/media'), '48')
    opened.page.unmount()
  })

  it('FINDING: with no new submission the pending card reads 0, not the number of all submissions (RED on base)', async () => {
    const opened = await mountAdminPage(DASHBOARD, dashboardServer({
      // 12 submissions, all resolved: `countSubmissionsByStatus` emits no `new` key at all.
      'GET /api/admin/submissions': () => json({ ok: true, submissions: Array.from({ length: 12 }, (_, i) => ({ id: i + 1 })), counts: { resolved: 12 } }),
    }))
    assert.equal(statCard(opened.page, '/admin/submissions?status=new'), '0')
    opened.page.unmount()
  })

  it('FINDING: a stat the officer may not read (403) shows "—", not the "..." of a load still running (RED on base)', async () => {
    const opened = await mountAdminPage(DASHBOARD, dashboardServer({
      'GET /api/admin/submissions': () => h3Error(403, 'Bạn không có quyền xem đơn đăng ký.'),
    }))
    assert.equal(statCard(opened.page, '/admin/submissions?status=new'), '—')
    // The others are unaffected.
    assert.equal(statCard(opened.page, '/admin/content/articles'), '120')
    opened.page.unmount()
  })

  it('live tiles and breakdowns render the server numbers', async () => {
    const opened = await mountAdminPage(DASHBOARD, dashboardServer())
    const tiles = findAll(opened.page.root, el => el.props.role === 'region').map(textOf)
    assert.ok(tiles.some(text => text.includes(new Intl.NumberFormat('vi-VN').format(1234)) && text.includes('Lượt xem')), tiles.join(' | '))
    assert.ok(tiles.some(text => text.includes('2.5') && text.includes('Sự kiện/phút')), tiles.join(' | '))
    const svgs = findAll(opened.page.root, el => el.tag === 'svg').map(el => String(el.props['aria-label']))
    assert.ok(svgs.some(label => label.startsWith('Biểu đồ nguồn truy cập: Tìm kiếm 50%, Trực tiếp 50%')), svgs.join(' | '))
    assert.ok(svgs.some(label => label.startsWith('Biểu đồ thiết bị: Điện thoại 50%, Máy tính 50%')), svgs.join(' | '))
    opened.page.unmount()
  })

  it('a failed live read shows the page\'s alert, and "Thử lại" re-reads the live summary only', async () => {
    let failLive = true
    const opened = await mountAdminPage(DASHBOARD, dashboardServer({
      'GET /api/admin/analytics/live': () => (failLive ? h3Error(403, 'Bạn không có quyền xem thống kê.') : json(LIVE)),
    }))
    assert.match(alertText(opened.page), /Không thể tải dữ liệu trực tiếp\./)
    assertOnlyServerSentences(opened)
    failLive = false
    const before = opened.calls.length
    const liveAlert = findAll(opened.page.root, el => el.props.role === 'alert' && textOf(el).includes('trực tiếp'))[0]!
    await click(byText(liveAlert, 'button', 'Thử lại'))
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire), ['GET /api/admin/analytics/live'])
    assert.doesNotMatch(alertText(opened.page), /trực tiếp/)
    opened.page.unmount()
  })

  it('without analytics:read nothing of the analytics API is asked for', async () => {
    const opened = await mountAdminPage(DASHBOARD, dashboardServer(), { can: (resource) => resource !== 'analytics' })
    assert.ok(opened.calls.every(call => !call.url.pathname.startsWith('/api/admin/analytics')), opened.calls.map(wire).join('\n'))
    opened.page.unmount()
  })
})

// ─── pages/admin/livestream/index.vue ────────────────────────────────────────

const LIVESTREAM = 'pages/admin/livestream/index.vue'
const EMBED = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?modestbranding=1&rel=0&playsinline=1'
const youtubeSession = (overrides: Record<string, unknown> = {}) => ({
  id: 9, title: 'Hội nghị tổng kết', description: null, source: 'youtube', embedUrl: EMBED, streamUrl: '', thumbnailUrl: null, startedAt: null, ...overrides,
})
const HISTORY = {
  ok: true, sessionId: 9,
  messages: [
    { id: 31, displayName: 'Bạn đọc', content: 'Xin chào buổi phát', createdAt: '2026-10-20T02:00:00.000Z' },
    // `serializeChatMessage` sends '' for a row whose `created_at` is NULL.
    { id: 32, displayName: 'Nguyễn An', content: 'Âm thanh rõ', createdAt: '' },
  ],
}

function livestreamServer(state: { session: Record<string, unknown> | null }, overrides: Record<string, (call: NetCall) => Response | Error> = {}) {
  return routes({
    'GET /api/public/livestream/active': () => json(state.session ? { ok: true, active: true, session: state.session } : { ok: true, active: false, session: null }),
    'GET /api/public/livestream/chat/history': () => json(state.session ? HISTORY : { ok: true, sessionId: null, messages: [] }),
    'POST /api/admin/media-portal/youtube-meta': () => json({ ok: true, title: 'Hội nghị trực tuyến', authorName: 'Kênh C11', thumbnailUrl: '/api/public/media/youtube-thumb/dQw4w9WgXcQ', videoId: 'dQw4w9WgXcQ' }),
    'POST /api/admin/livestream/start': () => { state.session = youtubeSession(); return json({ ok: true, sessionId: 9 }, 201) },
    'POST /api/admin/livestream/stop': () => { state.session = null; return json({ ok: true, sessionId: 9 }) },
    'DELETE /api/admin/livestream/chat/31': () => json({ ok: true, alreadyRemoved: false, sessionId: 9, messageId: 31 }),
    ...overrides,
  })
}

describe('pages/admin/livestream/index.vue', () => {
  afterEach(unmountAll)
  it('no session: reads the public active endpoint once and shows the empty branch and the start form', async () => {
    const opened = await mountAdminPage(LIVESTREAM, livestreamServer({ session: null }))
    assert.deepEqual(opened.calls.map(wire), ['GET /api/public/livestream/active'])
    assert.match(textOf(opened.page.root), /Không có buổi phát trực tiếp nào đang chạy/)
    assert.equal(buttons(opened.page, 'Bắt đầu phát').length, 1)
    opened.page.unmount()
  })

  it('an active session loads its chat (limit=100) and renders the nullable times as "—"', async () => {
    const opened = await mountAdminPage(LIVESTREAM, livestreamServer({ session: youtubeSession() }))
    assert.deepEqual(opened.calls.map(wire), ['GET /api/public/livestream/active', 'GET /api/public/livestream/chat/history?limit=100'])
    const text = textOf(opened.page.root)
    assert.match(text, /TRỰC TIẾP/)
    assert.match(text, /Hội nghị tổng kết/)
    const times = findAll(opened.page.root, el => el.tag === 'time').map(textOf)
    assert.deepEqual(times, [new Date('2026-10-20T02:00:00.000Z').toLocaleString('vi-VN'), '—'])
    // `startedAt: null` — the clock chip reads "—", never "1/1/1970".
    assert.doesNotMatch(text, /1970|Invalid Date/)
    const chip = findAll(opened.page.root, el => el.tag === 'span' && textOf(el) === '—' && String(el.props.class).includes('rounded-full'))
    assert.equal(chip.length, 1)
    opened.page.unmount()
  })

  it('FINDING: the YouTube preview iframe loads the embed URL, not the empty stream URL (RED on base)', async () => {
    const opened = await mountAdminPage(LIVESTREAM, livestreamServer({ session: youtubeSession() }))
    const frames = findAll(opened.page.root, el => el.tag === 'iframe')
    assert.equal(frames.length, 1)
    assert.equal(frames[0]!.props.src, EMBED)
    opened.page.unmount()
  })

  it('an HLS session (no embed URL) shows no preview iframe', async () => {
    const opened = await mountAdminPage(LIVESTREAM, livestreamServer({ session: youtubeSession({ source: 'upload', embedUrl: null, streamUrl: '/api/public/livestream/9/stream' }) }))
    assert.equal(findAll(opened.page.root, el => el.tag === 'iframe').length, 0)
    assert.match(textOf(opened.page.root), /Luồng HLS cơ quan/)
    opened.page.unmount()
  })

  it('"Lấy thông tin": posts the pasted URL, fills an empty title and normalises the field to the id', async () => {
    const opened = await mountAdminPage(LIVESTREAM, livestreamServer({ session: null }))
    const field = findAll(opened.page.root, el => el.tag === 'input' && el.props.id === 'ls-yt')[0]!
    await input(field, ' https://youtube.com/live/dQw4w9WgXcQ ')
    await settle()
    const before = opened.calls.length
    await click(byText(opened.page.root, 'button', 'Lấy thông tin'))
    await settle()
    assert.deepEqual(sent(opened.calls, before), [{ wire: 'POST /api/admin/media-portal/youtube-meta', body: { url: 'https://youtube.com/live/dQw4w9WgXcQ' } }])
    const title = findAll(opened.page.root, el => el.tag === 'input' && el.props.id === 'ls-title')[0]!
    assert.equal(title.model?.value, 'Hội nghị trực tuyến')
    assert.equal(findAll(opened.page.root, el => el.tag === 'input' && el.props.id === 'ls-yt')[0]!.model?.value, 'dQw4w9WgXcQ')
    assert.match(textOf(opened.page.root), /Kênh C11/)
    opened.page.unmount()
  })

  it('"Lấy thông tin" on an address the server refuses shows the page\'s own sentence for `reason: invalid`', async () => {
    const opened = await mountAdminPage(LIVESTREAM, livestreamServer({ session: null }, {
      'POST /api/admin/media-portal/youtube-meta': () => json({ ok: false, reason: 'invalid' }),
    }))
    await input(findAll(opened.page.root, el => el.tag === 'input' && el.props.id === 'ls-yt')[0]!, 'not a video')
    await settle()
    await click(byText(opened.page.root, 'button', 'Lấy thông tin'))
    await settle()
    assert.match(alertText(opened.page), /Địa chỉ video không hợp lệ hoặc không được hỗ trợ\./)
    opened.page.unmount()
  })

  it('start: posts the trimmed form (undefined fields left out), then re-reads the active session and its chat', async () => {
    const state = { session: null as Record<string, unknown> | null }
    const opened = await mountAdminPage(LIVESTREAM, livestreamServer(state))
    await input(findAll(opened.page.root, el => el.tag === 'input' && el.props.id === 'ls-title')[0]!, '  Hội nghị tổng kết  ')
    await input(findAll(opened.page.root, el => el.tag === 'input' && el.props.id === 'ls-yt')[0]!, ' dQw4w9WgXcQ ')
    await settle()
    const before = opened.calls.length
    await click(byText(opened.page.root, 'button', 'Bắt đầu phát'))
    await settle()
    assert.deepEqual(sent(opened.calls, before), [
      { wire: 'POST /api/admin/livestream/start', body: { title: 'Hội nghị tổng kết', source: 'youtube', youtubeVideoId: 'dQw4w9WgXcQ' } },
      'GET /api/public/livestream/active',
      'GET /api/public/livestream/chat/history?limit=100',
    ])
    assert.equal(opened.lastToast('success'), 'Đã bắt đầu buổi phát trực tiếp.')
    opened.page.unmount()
  })

  it('start refused by the server shows the server\'s sentence', async () => {
    const opened = await mountAdminPage(LIVESTREAM, livestreamServer({ session: null }, {
      'POST /api/admin/livestream/start': () => h3Error(409, 'Đang có một buổi phát khác chạy.'),
    }))
    await input(findAll(opened.page.root, el => el.tag === 'input' && el.props.id === 'ls-title')[0]!, 'Buổi mới')
    await input(findAll(opened.page.root, el => el.tag === 'input' && el.props.id === 'ls-yt')[0]!, 'dQw4w9WgXcQ')
    await settle()
    await click(byText(opened.page.root, 'button', 'Bắt đầu phát'))
    await settle()
    assert.equal(opened.lastToast('error'), 'Đang có một buổi phát khác chạy.')
    assertOnlyServerSentences(opened)
    opened.page.unmount()
  })

  it('stop: confirms, posts the session id, and re-reads the (now empty) state', async () => {
    const state = { session: youtubeSession() as Record<string, unknown> | null }
    const opened = await mountAdminPage(LIVESTREAM, livestreamServer(state))
    const before = opened.calls.length
    await click(byText(opened.page.root, 'button', 'Dừng buổi phát'))
    await settle()
    assert.equal(opened.confirms.at(-1)?.message, 'Dừng buổi phát trực tiếp này?')
    assert.deepEqual(sent(opened.calls, before), [
      { wire: 'POST /api/admin/livestream/stop', body: { sessionId: 9 } },
      'GET /api/public/livestream/active',
    ])
    assert.match(textOf(opened.page.root), /Không có buổi phát trực tiếp nào đang chạy/)
    opened.page.unmount()
  })

  it('removing a chat message deletes it through the admin route and drops it from the list', async () => {
    const opened = await mountAdminPage(LIVESTREAM, livestreamServer({ session: youtubeSession() }))
    const before = opened.calls.length
    const row = findAll(opened.page.root, el => el.tag === 'li' && textOf(el).includes('Xin chào buổi phát'))[0]!
    await click(byText(row, 'button', 'Gỡ'))
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire), ['DELETE /api/admin/livestream/chat/31'])
    assert.doesNotMatch(textOf(opened.page.root), /Xin chào buổi phát/)
    assert.equal(opened.lastToast('success'), 'Đã gỡ tin nhắn khỏi buổi phát.')
    opened.page.unmount()
  })

  it('a failed status read (503) shows the page\'s fallback in the alert; "Thử lại" reads again', async () => {
    let fail = true
    const opened = await mountAdminPage(LIVESTREAM, livestreamServer({ session: null }, {
      // The handler's own failure answer: 503 with the success shape and `ok: false`.
      'GET /api/public/livestream/active': () => (fail ? json({ ok: false, active: false, session: null }, 503) : json({ ok: true, active: false, session: null })),
    }))
    // ofetch retries a GET once on 5xx.
    assert.deepEqual(opened.calls.map(wire), ['GET /api/public/livestream/active', 'GET /api/public/livestream/active'])
    assert.match(alertText(opened.page), /Không tải được trạng thái buổi phát\./)
    assertOnlyServerSentences(opened)
    fail = false
    await click(byText(findAll(opened.page.root, el => el.props.role === 'alert')[0] as MiniElement, 'button', 'Thử lại'))
    await settle()
    assert.equal(alertText(opened.page), '')
    opened.page.unmount()
  })
})
