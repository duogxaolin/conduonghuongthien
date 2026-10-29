/**
 * Wave 3 D-FETCH, batch E: two children of the articles list — the view-count panel
 * `components/admin/articles/ArticleBoostStatsPanel.vue` (3 `$fetch` casts) and the "Dịch toàn
 * bộ bài viết" modal `components/admin/articles/ArticleGlobalTranslateModal.vue` (3) — call
 * `adminFetch<T>()` with response types derived from the handlers (app/types/admin-api.ts,
 * app/types/admin-articles-api.ts).
 *
 * Mounted through the REAL list page (`pages/admin/content/articles/index.vue`,
 * tests/_admin-page-harness.ts) with these two children real and the other three passthrough,
 * all over REAL ofetch on one fake network — so the row's "… lượt xem" button, the panel's
 * "Đóng", the header's "Dịch toàn bộ bài viết" and the page's reaction to `boost-applied` /
 * `started` are the page's own. Pinned, green before and after the conversion:
 *   - the panel reads the row's stats and shows the three totals, the sources, the days and a
 *     running boost; boosting / cancelling ask first, send their request, re-read the stats;
 *   - the modal reads the translation stats, preselects the languages still missing, and queues
 *     each selected language's missing published articles; refusals show the server's sentence.
 *
 * FINDINGS, RED on the base (88073004):
 *   - panel: open the stats of "Bài 3" on a slow connection, close it, open "Bài 4" — Bài 3's
 *     totals and running boost were shown under "Bài 4" (and its late failure or its `finally`
 *     overwrote Bài 4's state). Only the answer for the article still open is shown now;
 *   - modal: "Dịch toàn bộ" read ONE page of 100 missing articles per language (the list
 *     endpoint's cap) — with "Thiếu 120 bài" on screen it queued 100 and said it was done.
 *     DECISION after the independent verify (cost): the cap of 100 per language per click STAYS
 *     (reading every page queued 5 615 paid translations in one click on a 1 123-article DB, with
 *     no confirmation); the click now asks first with the numbers, and the toast says "100/120 —
 *     bấm lại" instead of "done". Leaving the page stops the loop;
 *   - modal: when a later language failed, the ones already queued were not reported — the
 *     toast said it could not start, `started` was never emitted, so the page did not poll the
 *     translation running in the background (and pressing again queued those articles twice);
 *   - modal: reopened after a failed stats load, it showed the PREVIOUS opening's numbers with
 *     "Bắt đầu dịch hàng loạt" enabled.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import * as Vue from 'vue'

import { click, findAll, input, textOf } from './_sfc-mount.ts'
import {
  alertText, dropped, h3Error, json, mountAdminPage, OFETCH_LINE, OpenModal, routes, settle, unmountAll, wire,
  type MountedAdminPage, type NetCall, type Responder,
} from './_admin-page-harness.ts'

afterEach(unmountAll)

type Route = (call: NetCall) => Response | Error | undefined

const LIST = 'pages/admin/content/articles/index.vue'
const article = (id: number, over: Record<string, unknown> = {}) => ({
  id, type: 'news', category: null, categoryId: null, categoryName: null, categoryParentId: null, parentCategoryName: null,
  title: `Bài ${id}`, slug: `bai-${id}`, excerpt: null, status: 'published', thumbnailUrl: null, commentsEnabled: false,
  publishedAt: null, createdAt: '2026-10-20T02:00:00.000Z', updatedAt: null, authorName: 'bientap', viewTotal: 1234, translatedLangs: '',
  ...over,
})
const ROWS = [article(3), article(4)]
const listAnswer = (items: unknown[], page = 1, total = items.length, perPage = 15) =>
  json({ ok: true, items, pagination: { page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) } })
const IDLE_STATUS = {
  ok: true, active: false, dbTranslatingCount: 0,
  task: { active: false, total: 0, processed: 0, currentArticleId: null, currentArticleTitle: null, langCode: '', langName: '', startedAt: null, completedAt: null },
}
const STATS = (id: number, real: number, fabricated: number, boost: unknown = null) => json({
  ok: true, article: { id, title: `Bài ${id}` },
  stats: {
    totalReal: real, totalFabricated: fabricated, totalDisplayed: real + fabricated, days: 30,
    bySource: [{ sourceCategory: 'search', views: real }], daily: [{ day: '2026-10-20', real, fabricated, total: real + fabricated }],
  },
  boost,
})
const RUNNING = { id: 1, totalAmount: 600, appliedAmount: 150, durationMinutes: 60, startedAt: '2026-10-20T02:00:00.000Z', endsAt: '2026-10-20T03:00:00.000Z' }
const LANGS = (missingEn = 1, missingFr = 0) => ({
  ok: true, totalArticles: 2, aiPendingTranslations: 0,
  languages: [
    { code: 'en', name: 'English', nativeName: 'English', translated: 2 - missingEn, missing: missingEn },
    { code: 'fr', name: 'Français', nativeName: 'Français', translated: 2 - missingFr, missing: missingFr },
  ],
})
/** The modal's list request: `?translation=missing_<lang>` (the page's own list has no `translation`). */
const isMissingList = (call: NetCall) => call.method === 'GET' && call.url.pathname === '/api/admin/articles' && call.url.searchParams.has('translation')

function server(overrides: Record<string, Route> = {}): Responder {
  return routes({
    'GET /api/admin/categories': () => json({ ok: true, items: [] }),
    'GET /api/admin/articles/authors': () => json({ ok: true, items: [], orphanCount: 0 }),
    'GET /api/admin/content-types': () => json({ ok: true, items: [{ id: 1, slug: 'news', name: 'Bản tin', isSystem: true }] }),
    'GET /api/admin/articles': call => (call.url.searchParams.get('translation') === 'missing_en' ? listAnswer([article(4)], 1, 1, 100) : listAnswer(ROWS)),
    'GET /api/admin/articles/bulk-translate-status': () => json(IDLE_STATUS),
    'GET /api/admin/articles/translation-stats': () => json(LANGS()),
    'GET /api/admin/articles/3/stats': () => STATS(3, 900, 300, RUNNING),
    'GET /api/admin/articles/4/stats': () => STATS(4, 40, 0),
    'POST /api/admin/articles/3/boost': call => json({ ok: true, mode: (call.body as { mode: string }).mode, amount: 500 }),
    'DELETE /api/admin/articles/3/boost': () => json({ ok: true, cancelled: { id: 1, appliedAmount: 150, totalAmount: 600 } }),
    'POST /api/admin/articles/bulk-translate': call => json({ ok: true, count: (call.body as { ids: number[] }).ids.length }),
    ...overrides,
  })
}

const passthrough = (name: string) => ({ default: Vue.defineComponent({ name, setup: () => () => Vue.h('div', { 'data-stub': name }) }) })
const MODULES = {
  ...Object.fromEntries(['ArticleQuickViewModal', 'ArticleBulkTranslateBanner', 'ScanThumbnailsModal']
    .map(name => [`~/components/admin/articles/${name}.vue`, passthrough(name)])),
  '~/components/admin/AdminModal.vue': { default: OpenModal },
}
const open = (responder = server()) => mountAdminPage(LIST, responder, { modules: MODULES })

// ─── The view-count panel ────────────────────────────────────────────────────

const panel = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.props['aria-labelledby'] === 'stats-modal-title')[0]
const panelText = (opened: MountedAdminPage) => (panel(opened) ? textOf(panel(opened)!) : '')
/** The row's "… lượt xem" button (mobile card and desktop row both carry one; the first). */
async function openStats(opened: MountedAdminPage, id: number, wait = true) {
  const done = click(findAll(opened.page.root, el => el.tag === 'button' && el.props['aria-label'] === `Xem thống kê lượt xem bài viết: Bài ${id}`)[0]!)
  if (wait) await done
  await settle()
}
async function closeStats(opened: MountedAdminPage) {
  await click(findAll(panel(opened)!, el => el.tag === 'button' && el.props['aria-label'] === 'Đóng')[0]!)
  await settle()
}
const panelButton = (opened: MountedAdminPage, label: string) => findAll(panel(opened)!, el => el.tag === 'button' && textOf(el).includes(label))[0]!
const panelField = (opened: MountedAdminPage, label: string) => {
  const owner = findAll(panel(opened)!, el => el.tag === 'label' && textOf(el).startsWith(label))[0]!
  return findAll(owner, el => el.tag === 'input' || el.tag === 'select')[0]!
}
const statsCalls = (opened: MountedAdminPage, from = 0) => opened.calls.slice(from).filter(call => /\/stats$|\/boost$/.test(call.url.pathname)).map(wire)
const N = (n: number) => n.toLocaleString('vi-VN')

describe('components/admin/articles/ArticleBoostStatsPanel.vue (through the articles list)', () => {
  it('opening a row reads its stats: the three totals, the sources, the days, the running boost', async () => {
    const opened = await open()
    const before = opened.calls.length
    await openStats(opened, 3)
    assert.deepEqual(statsCalls(opened, before), ['GET /api/admin/articles/3/stats'])
    const text = panelText(opened)
    assert.match(text, /Bài 3/)
    assert.match(text, new RegExp(`Tổng hiển thị\\s*${N(1200)}\\s*Lượt xem thật\\s*${N(900)}\\s*Lượt xem ảo\\s*${N(300)}`))
    assert.match(text, /Từ công cụ tìm kiếm/)
    assert.match(text, new RegExp(`Đang cộng dần: ${N(150)} / ${N(600)} lượt`))
    assert.equal(alertText(opened.page), '')
  })

  it('an instant boost asks first, POSTs, re-reads the stats and makes the list reload; a gradual one sends its minutes', async () => {
    const opened = await open()
    await openStats(opened, 3)
    await input(panelField(opened, 'Số lượt xem'), 500)
    const before = opened.calls.length
    await click(panelButton(opened, 'Thực hiện'))
    await settle()
    assert.match(opened.confirms.at(-1)!.message!, /Cộng ngay 500 lượt xem ảo cho bài "Bài 3"/)
    const after = opened.calls.slice(before)
    assert.deepEqual(after.filter(c => c.url.pathname.includes('/3/')).map(c => (c.body === undefined ? wire(c) : [wire(c), c.body])),
      [['POST /api/admin/articles/3/boost', { mode: 'instant', amount: 500 }], 'GET /api/admin/articles/3/stats'])
    assert.ok(after.some(c => c.url.pathname === '/api/admin/articles' && !c.url.searchParams.has('translation')), 'the list did not reload after boost-applied')
    assert.equal(opened.lastToast('success'), 'Đã cộng lượt xem ảo.')

    await input(panelField(opened, 'Chế độ'), 'gradual')
    await input(panelField(opened, 'Số lượt xem'), 200)
    await input(panelField(opened, 'Thời lượng'), 30)
    const next = opened.calls.length
    await click(panelButton(opened, 'Thực hiện'))
    await settle()
    assert.deepEqual(opened.calls.slice(next).find(c => c.method === 'POST')?.body, { mode: 'gradual', amount: 200, minutes: 30 })
  })

  it('an invalid amount is refused on the page; a refused boost shows the server\'s sentence', async () => {
    const opened = await open(server({ 'POST /api/admin/articles/3/boost': () => h3Error(409, 'Bài viết đang có một lượt tăng dần chạy dở. Vui lòng huỷ lượt đó trước.') }))
    await openStats(opened, 3)
    await input(panelField(opened, 'Số lượt xem'), 0)
    const before = opened.calls.length
    await click(panelButton(opened, 'Thực hiện'))
    await settle()
    assert.equal(opened.calls.length, before)
    assert.equal(opened.lastToast('error'), 'Vui lòng nhập số lượt xem là số nguyên lớn hơn 0.')
    await input(panelField(opened, 'Số lượt xem'), 5)
    await click(panelButton(opened, 'Thực hiện'))
    await settle()
    assert.equal(opened.lastToast('error'), 'Bài viết đang có một lượt tăng dần chạy dở. Vui lòng huỷ lượt đó trước.')
  })

  it('cancelling the running boost asks first, DELETEs, re-reads the stats', async () => {
    const opened = await open()
    await openStats(opened, 3)
    const before = opened.calls.length
    await click(panelButton(opened, 'Huỷ lượt tăng'))
    await settle()
    assert.match(opened.confirms.at(-1)!.message!, new RegExp(`Phần đã cộng \\(${N(150)} lượt\\)`))
    assert.deepEqual(statsCalls(opened, before), ['DELETE /api/admin/articles/3/boost', 'GET /api/admin/articles/3/stats'])
    assert.equal(opened.lastToast('success'), 'Đã huỷ lượt tăng dần.')
  })

  it('a failed stats load is an alert with the server\'s sentence and "Thử lại", which reads them again', async () => {
    let fail = true
    const opened = await open(server({ 'GET /api/admin/articles/4/stats': () => (fail ? h3Error(404, 'Bài viết không tồn tại.') : STATS(4, 40, 0)) }))
    await openStats(opened, 4)
    assert.equal(alertText(opened.page), 'Bài viết không tồn tại.Thử lại')
    assert.doesNotMatch(alertText(opened.page), OFETCH_LINE)
    fail = false
    await click(panelButton(opened, 'Thử lại'))
    await settle()
    assert.equal(alertText(opened.page), '')
    assert.match(panelText(opened), new RegExp(`Lượt xem thật\\s*${N(40)}`))
  })

  it('FINDING: the stats of a closed article, answered last, are not shown under the article now open (RED on base)', async () => {
    const held: NetCall[] = []
    const opened = await open(server({ 'GET /api/admin/articles/3/stats': call => { held.push(call); return undefined } }))
    await openStats(opened, 3, false)
    await closeStats(opened)
    await openStats(opened, 4)
    assert.match(panelText(opened), new RegExp(`Lượt xem thật\\s*${N(40)}`))
    held[0]!.respond(STATS(3, 900, 300, RUNNING))
    await settle()
    const text = panelText(opened)
    assert.match(text, /Bài 4/)
    assert.ok(!text.includes(N(900)) && !text.includes('Đang cộng dần'), `Bài 3's numbers under Bài 4: ${text.slice(0, 200)}`)
  })

  it('FINDING: answered while the article now open is still loading, they neither end its loading nor show (RED on base)', async () => {
    const held: NetCall[] = []
    const opened = await open(server({
      'GET /api/admin/articles/3/stats': call => { held.push(call); return undefined },
      'GET /api/admin/articles/4/stats': call => { held.push(call); return undefined },
    }))
    await openStats(opened, 3, false)
    await closeStats(opened)
    await openStats(opened, 4, false)
    held[0]!.respond(STATS(3, 900, 300, RUNNING))
    await settle()
    assert.match(panelText(opened), /Đang tải số liệu lượt xem/, 'the loading state ended on the closed article\'s answer')
    assert.ok(!panelText(opened).includes(N(900)))
    held[1]!.respond(STATS(4, 40, 0))
    await settle()
    assert.match(panelText(opened), new RegExp(`Lượt xem thật\\s*${N(40)}`))
  })

  it('FINDING: a closed article\'s stats failing late put no error over the article now open (RED on base)', async () => {
    const held: NetCall[] = []
    const opened = await open(server({ 'GET /api/admin/articles/3/stats': call => { held.push(call); return undefined } }))
    await openStats(opened, 3, false)
    await closeStats(opened)
    await openStats(opened, 4)
    held[0]!.respond(h3Error(404, 'Bài viết không tồn tại.'))
    await settle()
    assert.equal(alertText(opened.page), '', 'the closed article\'s failure replaced the open one\'s numbers')
    assert.match(panelText(opened), new RegExp(`Lượt xem thật\\s*${N(40)}`))
  })
})

// ─── The "Dịch toàn bộ bài viết" modal ───────────────────────────────────────

const modal = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.props.role === 'dialog' && el.props['aria-label'] === 'Dịch toàn bộ bài viết bằng AI')[0]
const modalText = (opened: MountedAdminPage) => (modal(opened) ? textOf(modal(opened)!) : '')
const startButton = (opened: MountedAdminPage) => findAll(modal(opened)!, el => el.tag === 'button' && textOf(el).includes('Bắt đầu dịch hàng loạt'))[0]!
async function openModal(opened: MountedAdminPage) {
  await click(findAll(opened.page.root, el => el.tag === 'button' && textOf(el) === 'Dịch toàn bộ bài viết')[0]!)
  await settle()
}
async function closeModal(opened: MountedAdminPage) {
  await click(findAll(modal(opened)!, el => el.tag === 'button' && textOf(el) === 'Hủy')[0]!)
  await settle()
}
const langBox = (opened: MountedAdminPage, code: string) => findAll(modal(opened)!, el => el.tag === 'input' && el.props.type === 'checkbox' && el.props.value === code)[0]!
const selected = (opened: MountedAdminPage) => langBox(opened, 'en').model?.value as string[]
const queued = (opened: MountedAdminPage, from = 0) => opened.calls.slice(from).filter(c => c.method === 'POST' && c.url.pathname === '/api/admin/articles/bulk-translate').map(c => c.body)
const pollsStarted = (opened: MountedAdminPage, from: number) => opened.calls.slice(from).some(c => c.url.pathname === '/api/admin/articles/bulk-translate-status')

describe('components/admin/articles/ArticleGlobalTranslateModal.vue (through the articles list)', () => {
  it('opening reads the translation stats and preselects the languages still missing', async () => {
    const opened = await open()
    const before = opened.calls.length
    await openModal(opened)
    assert.deepEqual(opened.calls.slice(before).map(wire), ['GET /api/admin/articles/translation-stats'])
    assert.match(modalText(opened), /Tổng số bài viết đã xuất bản trên cổng: 2 bài viết\./)
    assert.match(modalText(opened), /EnglishThiếu 1 bài/)
    assert.match(modalText(opened), /FrançaisĐã đủ/)
    assert.deepEqual(selected(opened), ['en'])
    assert.equal(startButton(opened).props.disabled, false)
  })

  it('start: each selected language\'s missing published articles are queued with the chosen status; the page then polls', async () => {
    const opened = await open()
    await openModal(opened)
    await input(findAll(modal(opened)!, el => el.tag === 'input' && el.props.type === 'radio' && el.props.value === 'published')[0]!, 'published')
    const before = opened.calls.length
    await click(startButton(opened))
    await settle()
    const list = opened.calls.slice(before).filter(isMissingList)
    assert.equal(list.length, 1)
    assert.deepEqual(Object.fromEntries([...list[0]!.url.searchParams].filter(([k]) => k !== 'page')), { translation: 'missing_en', perPage: '100', status: 'published' })
    assert.deepEqual(queued(opened, before), [{ ids: [4], langCode: 'en', targetStatus: 'published' }])
    assert.equal(opened.lastToast('success'), 'Đã xếp lịch dịch 1 lượt bài viết sang 1 ngôn ngữ! Hệ thống đang xử lý trong nền.')
    assert.ok(!modal(opened), 'the modal stays open after `started`')
    assert.ok(pollsStarted(opened, before), 'the page did not read the bulk status after `started`')
  })

  it('nothing missing: says so and queues nothing; no language picked: refused without a request', async () => {
    const opened = await open(server({ 'GET /api/admin/articles': call => (isMissingList(call) ? listAnswer([], 1, 0, 100) : listAnswer(ROWS)) }))
    await openModal(opened)
    const before = opened.calls.length
    await click(startButton(opened))
    await settle()
    assert.deepEqual(queued(opened, before), [])
    assert.equal(opened.lastToast('info'), 'Tất cả các bài viết đã có bản dịch cho các ngôn ngữ đã chọn!')
    await click(findAll(modal(opened)!, el => el.tag === 'button' && textOf(el) === 'Bỏ chọn')[0]!)
    const next = opened.calls.length
    await click(startButton(opened))
    await settle()
    assert.equal(opened.calls.length, next)
    assert.equal(opened.lastToast('warning'), 'Vui lòng chọn ít nhất một ngôn ngữ.')
  })

  it('a failed stats load and a refused queue show the server\'s sentence', async () => {
    const opened = await open(server({
      'GET /api/admin/articles/translation-stats': () => h3Error(403, 'Bạn không có quyền xem bài viết.'),
    }))
    await openModal(opened)
    assert.equal(opened.lastToast('error'), 'Bạn không có quyền xem bài viết.')
    assert.equal(startButton(opened).props.disabled, true)
    const refused = await open(server({ 'POST /api/admin/articles/bulk-translate': () => h3Error(400, 'Chưa chọn bài viết hợp lệ nào.') }))
    await openModal(refused)
    await click(startButton(refused))
    await settle()
    assert.equal(refused.lastToast('error'), 'Chưa chọn bài viết hợp lệ nào.')
    for (const t of refused.toasts) assert.doesNotMatch(t.message, OFETCH_LINE)
  })

  /**
   * A fake server that behaves like `missing_<lang>`: an article leaves the list once it has a translation
   * row — modelled as "once queued and translated" — and an article whose row is `failed` never shows up
   * in it at all (the list's NOT EXISTS sees the failed row), while the stats still count it as missing.
   */
  function missingServer(missing: number[], failed: number[] = []) {
    const translated = new Set<number>()
    return server({
      'GET /api/admin/articles/translation-stats': () => json({
        ...LANGS(), totalArticles: missing.length + failed.length,
        languages: [{ code: 'en', name: 'English', nativeName: 'English', translated: 0, missing: missing.length + failed.length }],
      }),
      'GET /api/admin/articles': (call) => {
        if (!isMissingList(call)) return listAnswer(ROWS)
        const left = missing.filter(id => !translated.has(id)).map(id => article(id))
        return listAnswer(left.slice(0, 100), 1, left.length, 100)
      },
      'POST /api/admin/articles/bulk-translate': (call) => {
        for (const id of (call.body as { ids: number[] }).ids) translated.add(id)
        return json({ ok: true, count: (call.body as { ids: number[] }).ids.length })
      },
    })
  }
  const ids = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i)

  it('DECISION (verify E, cost): one click queues at most 100 per language and says 100/N; the next click queues the next ones', async () => {
    const opened = await open(missingServer(ids(100, 120)))
    await openModal(opened)
    let before = opened.calls.length
    await click(startButton(opened))
    await settle()
    let sent = queued(opened, before) as Array<{ ids: number[] }>
    assert.equal(sent.length, 1, 'one request per language')
    assert.deepEqual(sent[0]!.ids, ids(100, 100), 'more than the per-click cap of 100 was queued')
    assert.ok(opened.calls.slice(before).filter(isMissingList).every(c => !c.url.searchParams.has('page')), 'paged past the first 100')
    const told = opened.lastToast('success') ?? ''
    assert.match(told, /100\/120/, `the toast hides that 20 are left: "${told}"`)
    assert.match(told, /bấm lại/)
    assert.ok(pollsStarted(opened, before), 'the page was not told a translation started')
    // Second click (the first batch has been translated): the next 20, none of the first 100 again.
    await openModal(opened)
    before = opened.calls.length
    await click(startButton(opened))
    await settle()
    sent = queued(opened, before) as Array<{ ids: number[] }>
    assert.deepEqual(sent.map(s => s.ids), [ids(200, 20)])
    assert.equal(opened.lastToast('success'), 'Đã xếp lịch dịch 20 lượt bài viết sang 1 ngôn ngữ! Hệ thống đang xử lý trong nền.')
  })

  it('DECISION (verify E, cost): the click asks first, naming languages × articles and that each is a paid AI call; declining queues nothing', async () => {
    const opened = await open(missingServer(ids(100, 120)))
    await openModal(opened)
    opened.answers.confirm = false
    const before = opened.calls.length
    await click(startButton(opened))
    await settle()
    const asked = opened.confirms.at(-1)?.message ?? ''
    assert.match(asked, /tối đa 100 bài sang 1 ngôn ngữ/, `no count in the confirmation: "${asked}"`)
    assert.match(asked, /en: 100\/120/)
    assert.match(asked, /tính phí/)
    assert.deepEqual(queued(opened, before), [])
    assert.equal(opened.calls.slice(before).filter(isMissingList).length, 0, 'the list was read before the officer agreed')
    assert.ok(!pollsStarted(opened, before))
  })

  it('KNOWN (server, not fixed here): an article whose translation FAILED is counted missing but never listed, so never queued', async () => {
    // Stats: "Thiếu 3 bài" (failed rows are not "translated"); the list's NOT EXISTS hides #9 — it is never sent.
    const opened = await open(missingServer([7, 8], [9]))
    await openModal(opened)
    assert.match(modalText(opened), /Thiếu 3 bài/)
    const before = opened.calls.length
    await click(startButton(opened))
    await settle()
    assert.deepEqual(queued(opened, before), [{ ids: [7, 8], langCode: 'en', targetStatus: 'ai_draft' }])
    assert.equal(opened.lastToast('success'), 'Đã xếp lịch dịch 2 lượt bài viết sang 1 ngôn ngữ! Hệ thống đang xử lý trong nền.')
  })

  it('verify E: leaving the page while a language is being read queues nothing after it', async () => {
    const held: NetCall[] = []
    const opened = await open(server({
      'GET /api/admin/articles/translation-stats': () => json(LANGS(1, 1)),
      'GET /api/admin/articles': call => (isMissingList(call) ? (held.push(call), undefined) : listAnswer(ROWS)),
    }))
    await openModal(opened)
    void click(startButton(opened))
    await settle()
    assert.equal(held.length, 1)
    const before = opened.calls.length
    opened.page.unmount()
    held[0]!.respond(listAnswer([article(4)], 1, 1, 100))
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire), [], 'requests sent after the page was left')
  })

  it('FINDING: a language failing after another was queued reports the queued one and lets the page follow it (RED on base)', async () => {
    const opened = await open(server({
      'GET /api/admin/articles/translation-stats': () => json(LANGS(1, 1)),
      'GET /api/admin/articles': (call) => {
        if (!isMissingList(call)) return listAnswer(ROWS)
        return call.url.searchParams.get('translation') === 'missing_en' ? listAnswer([article(4)], 1, 1, 100) : dropped()
      },
    }))
    await openModal(opened)
    assert.deepEqual(selected(opened), ['en', 'fr'])
    const before = opened.calls.length
    await click(startButton(opened))
    await settle()
    assert.deepEqual(queued(opened, before), [{ ids: [4], langCode: 'en', targetStatus: 'ai_draft' }])
    const error = opened.lastToast('error') ?? ''
    assert.match(error, /1 lượt bài viết/, `the toast hides what was already queued: "${error}"`)
    assert.doesNotMatch(error, OFETCH_LINE)
    assert.ok(pollsStarted(opened, before), 'the page was not told a translation started (no `started`)')
  })

  it('FINDING: reopened after a failed stats load, it shows no stale numbers and cannot start (RED on base)', async () => {
    let fail = false
    const opened = await open(server({ 'GET /api/admin/articles/translation-stats': () => (fail ? h3Error(400, 'Không đọc được thống kê.') : json(LANGS())) }))
    await openModal(opened)
    assert.match(modalText(opened), /Thiếu 1 bài/)
    await closeModal(opened)
    fail = true
    await openModal(opened)
    assert.equal(opened.lastToast('error'), 'Không đọc được thống kê.')
    assert.ok(!/Thiếu 1 bài|Tổng số bài viết/.test(modalText(opened)), 'the previous opening\'s numbers are shown after a failed load')
    assert.equal(startButton(opened).props.disabled, true, '"Bắt đầu" is enabled on stale numbers')
  })
})
