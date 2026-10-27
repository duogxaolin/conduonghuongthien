/**
 * Wave 3 D-FETCH, batch B: the article list (`pages/admin/content/articles/index.vue`, 12
 * `$fetch` casts) and the article editor's translation panel
 * (`components/admin/articles/ArticleTranslationPanel.vue`, 7) call `adminFetch<T>()` with
 * response types derived from the handlers (app/types/admin-articles-api.ts).
 *
 * Neither moves to `useAdminList`: the list is refreshed silently by the bulk-translate
 * poll (a `loading` flip would flash the skeleton every 2.5 s) and its rows are edited in
 * place by the optimistic translate updates; the panel is not a list. Their source
 * contracts stay in tests/admin-bulk-selection-ui.test.ts, admin-error-retry-ui and
 * skeleton-loading-ui.
 *
 * The REAL component — `<script setup>` and template — is mounted
 * (tests/_admin-page-harness.ts) over REAL ofetch on a fake network; the modals, the
 * banner and the editor are stand-ins that carry the page's props and listeners. Pinned,
 * green before and after the conversion:
 *   - the requests of the mount and of every action (method, path, query, body, the
 *     `blob` export) and the reloads after them;
 *   - the cells that format nullable values (`createdAt`, `authorName`, `categoryName`,
 *     a failed translation's `errorMessage`);
 *   - a failure shows the sentence the SERVER wrote, never ofetch's `[GET] "…"` line.
 *
 * FINDINGS, each RED on the base (ea5b500):
 *   - the article list had no notion of the latest request: an officer who changed one
 *     filter and then another before the first answer was back got the FIRST filter's
 *     rows under the second filter's controls, and a silent refresh (after a translate,
 *     every 2.5 s while a bulk translation runs) that was asked before a filter change
 *     and answered after it put the old rows back — nothing on screen said so;
 *   - "Thử lại lỗi (N)" in the translation panel counted the failed translations AFTER
 *     retrying them, so it always reported "Đã kích hoạt thử lại cho 0 bản dịch lỗi."
 * The first fix of the list (b061ecc) only gave LOADS a ticket; the independent verify found
 * three more holes, each RED on b061ecc: of two silent refreshes the older one answered
 * last put its rows back; a silent refresh sent while a filter load ran (still asking for
 * the old page) landed after it and emptied the table; and a silent refresh never narrowed
 * the selection, so a ticked row gone from the screen stayed deletable. Now every request
 * takes a ticket, no silent refresh is sent during a load, and every write narrows.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it, mock } from 'node:test'
import * as Vue from 'vue'

import { adminFetch } from '../app/composables/adminFetch.ts'
import { byText, click, findAll, fire, input, textOf, type MiniElement } from './_sfc-mount.ts'
import {
  alertText, h3Error, installNetwork, json, mountAdminPage, OFETCH_LINE, routes, sent, settle, unmountAll, wire,
  type MountedAdminPage, type NetCall,
} from './_admin-page-harness.ts'

function assertOnlyServerSentences(opened: MountedAdminPage) {
  for (const t of opened.toasts) assert.doesNotMatch(t.message, OFETCH_LINE, `toast "${t.message}"`)
  assert.doesNotMatch(alertText(opened.page), OFETCH_LINE)
}

/** A child that renders a marker element carrying the props and listeners the parent passes. */
const passthrough = (name: string) => ({ default: Vue.defineComponent({ name, setup: () => () => Vue.h('div', { 'data-stub': name }) }) })
const stub = (opened: MountedAdminPage, name: string) => findAll(opened.page.root, el => el.props['data-stub'] === name)[0]!

// ─── pages/admin/content/articles/index.vue ──────────────────────────────────

const LIST = 'pages/admin/content/articles/index.vue'
const article = (id: number, overrides: Record<string, unknown> = {}) => ({
  id, type: 'news', category: null, categoryId: null, categoryName: null, categoryParentId: null, parentCategoryName: null,
  title: `Bài ${id}`, slug: `bai-${id}`, excerpt: null, status: 'published', thumbnailUrl: null, commentsEnabled: false,
  publishedAt: null, createdAt: '2026-10-20T02:00:00.000Z', updatedAt: null, authorName: 'bientap', viewTotal: 1234, translatedLangs: '',
  ...overrides,
})
const ROWS = [
  article(3, { translatedLangs: 'en:published,fr:ai_draft', categoryName: 'Tin tức', parentCategoryName: 'Truyền thông' }),
  article(4, { createdAt: null, authorName: null, status: 'draft', viewTotal: 0 }),
]
const listAnswer = (items: unknown[], page = 1, total = items.length) =>
  json({ ok: true, items, pagination: { page, perPage: 15, total, totalPages: Math.max(1, Math.ceil(total / 15)) } })
const IDLE_STATUS = {
  ok: true, active: false, dbTranslatingCount: 0,
  task: { active: false, total: 0, processed: 0, currentArticleId: null, currentArticleTitle: null, langCode: '', langName: '', startedAt: null, completedAt: null },
}

function listServer(overrides: Record<string, (call: NetCall) => Response | Error | undefined> = {}) {
  return routes({
    'GET /api/admin/categories': () => json({ ok: true, items: [{ id: 21, name: 'Tin tức', slug: 'tin-tuc', type: 'news', parentId: null, displayOrder: 1 }] }),
    'GET /api/admin/articles/authors': () => json({ ok: true, items: [{ id: 5, username: 'bientap', articleCount: 2 }], orphanCount: 1 }),
    'GET /api/admin/content-types': () => json({ ok: true, items: [{ id: 1, slug: 'news', name: 'Bản tin', isSystem: true }] }),
    'GET /api/admin/articles': () => listAnswer(ROWS),
    'GET /api/admin/articles/bulk-translate-status': () => json(IDLE_STATUS),
    'GET /api/admin/articles/translation-stats': () => json({ ok: true, totalArticles: 2, languages: [], aiPendingTranslations: 4 }),
    'PUT /api/admin/articles/3': () => json({ ok: true }),
    'DELETE /api/admin/articles/4': () => json({ ok: true }),
    'POST /api/admin/articles/bulk-translate': () => json({ ok: true, count: 1 }),
    'POST /api/admin/articles/3/translations/translate': () => json({ ok: true, message: 'Đã bắt đầu dịch. Vui lòng đợi.' }),
    'POST /api/admin/articles/bulk-publish-translations': () => json({ ok: true, published: 3, skipped: 1, skippedTranslating: 1, skippedFailed: 0 }),
    'GET /api/admin/articles/export-batch': () => new Response(new Blob(['PK-zip']), { status: 200, headers: { 'content-type': 'application/zip' } }),
    'POST /api/admin/articles/export-google': () => json({ sheetUrl: 'https://docs.google.com/spreadsheets/d/x', folderUrl: 'https://drive.google.com/drive/folders/y', count: 1 }),
    ...overrides,
  })
}

const LIST_CHILDREN = Object.fromEntries(['ArticleQuickViewModal', 'ArticleGlobalTranslateModal', 'ArticleBoostStatsPanel', 'ArticleBulkTranslateBanner', 'ScanThumbnailsModal']
  .map(name => [`~/components/admin/articles/${name}.vue`, passthrough(name)]))
const openList = (server = listServer()) => mountAdminPage(LIST, server, { modules: LIST_CHILDREN })

/** The list request as ofetch writes `params`: an empty value is the bare key (`search&type`). */
const ARTICLES_QUERY = (overrides: Record<string, string> = {}) => {
  const params = { page: '1', search: '', type: '', status: '', perPage: '15', ...overrides }
  return `GET /api/admin/articles?${Object.entries(params).map(([k, v]) => (v === '' ? k : `${k}=${encodeURIComponent(v)}`)).join('&')}`
}
const tableRows = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'tbody').flatMap(body => body.children.filter((row): row is MiniElement => row.kind === 'element'))
const rowOf = (opened: MountedAdminPage, title: string) => tableRows(opened).find(tr => textOf(tr).includes(title))!
const cells = (row: MiniElement) => findAll(row, el => el.tag === 'td').map(textOf)
const shownTitles = (opened: MountedAdminPage) => tableRows(opened).map(tr => textOf(findAll(tr, el => el.tag === 'p')[0]!))
const select = (opened: MountedAdminPage, label: string) => findAll(opened.page.root, el => el.tag === 'select' && el.props['aria-label'] === label)[0]!
async function pick(el: MiniElement, value: unknown) {
  await input(el, value)
  await fire(el, 'change')
}
/** Pick without waiting for the load it starts — for a request the test answers later. */
async function pickHeld(el: MiniElement, value: unknown) {
  await input(el, value)
  void fire(el, 'change')
  await settle()
}
async function tick(row: MiniElement) {
  await fire(findAll(row, el => el.tag === 'input' && el.props.type === 'checkbox')[0]!, 'change')
  await settle()
}
const bulkBar = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'AdminBulkActionBar')[0]!

describe('pages/admin/content/articles/index.vue', () => {
  afterEach(() => { unmountAll(); mock.timers.reset() })

  it('mount: categories, authors and content types together, then page 1, the bulk status and the AI badge count', async () => {
    const opened = await openList()
    assert.deepEqual(opened.calls.map(wire), [
      'GET /api/admin/categories',
      'GET /api/admin/articles/authors',
      'GET /api/admin/content-types',
      ARTICLES_QUERY(),
      'GET /api/admin/articles/bulk-translate-status',
      'GET /api/admin/articles/translation-stats',
    ])
    opened.page.unmount()
  })

  it('rows: the nullable cells read "Admin", "Chưa phân loại" and "—"; the translation badges and views render', async () => {
    const opened = await openList()
    // Cells: checkbox, article, type, category, status, views, comments, translations, created, actions.
    const first = cells(rowOf(opened, 'Bài 3'))
    assert.deepEqual(first.slice(1, 9), [
      'Bài 3bientap', 'Bản tin', 'Truyền thông › Tin tức', 'Đã đăng', (1234).toLocaleString('vi-VN'),
      'Đang đóng', 'en fr', new Date('2026-10-20T02:00:00.000Z').toLocaleString('vi-VN'),
    ])
    const second = cells(rowOf(opened, 'Bài 4'))
    assert.deepEqual(second.slice(1, 9), ['Bài 4Admin', 'Bản tin', 'Chưa phân loại', 'Nháp', '0', 'Đang đóng', 'Dịch', '—'])
    assert.match(textOf(select(opened, 'Lọc theo người đăng bài')), /bientap \(2\).*Không rõ tác giả \(1\)/)
    opened.page.unmount()
  })

  it('a filter change reloads page 1 with the filter, and the categories of the chosen type', async () => {
    const opened = await openList()
    const before = opened.calls.length
    await pick(select(opened, 'Lọc theo thể loại bài viết'), 'news')
    await settle()
    // The `selectedType` watcher (categories of the type) runs before the `@change` handler.
    assert.deepEqual(opened.calls.slice(before).map(wire), ['GET /api/admin/categories?type=news', ARTICLES_QUERY({ type: 'news' })])
    const next = opened.calls.length
    await pick(select(opened, 'Lọc theo người đăng bài'), 'none')
    await settle()
    assert.deepEqual(opened.calls.slice(next).map(wire), [`${ARTICLES_QUERY({ type: 'news' })}&authorId=none`])
    opened.page.unmount()
  })

  it('the pager asks for the page it emits, with the same filters', async () => {
    const opened = await openList()
    const before = opened.calls.length
    await fire(findAll(opened.page.root, el => el.tag === 'AdminPagination')[0]!, 'update:page', 2)
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire), [ARTICLES_QUERY({ page: '2' })])
    opened.page.unmount()
  })

  it('FINDING: the older of two filter loads, answered last, does not replace the newer filter\'s rows (RED on base)', async () => {
    const held: NetCall[] = []
    const opened = await openList(listServer({
      'GET /api/admin/articles': (call) => {
        if (call.url.searchParams.get('type') || call.url.searchParams.get('status')) { held.push(call); return undefined }
        return listAnswer(ROWS)
      },
    }))
    await pickHeld(select(opened, 'Lọc theo thể loại bài viết'), 'news')
    await pickHeld(select(opened, 'Lọc theo trạng thái bài viết'), 'draft')
    const [first, second] = held.filter(call => call.url.pathname === '/api/admin/articles')
    assert.ok(first && second, `two loads expected, got ${held.map(wire).join(', ')}`)
    second!.respond(listAnswer([article(9, { title: 'Nháp tin tức', status: 'draft' })]))
    await settle()
    first!.respond(listAnswer([article(8, { title: 'Tin tức đã đăng' }), article(7, { title: 'Tin khác đã đăng' })]))
    await settle()
    assert.deepEqual(shownTitles(opened), ['Nháp tin tức'])
    opened.page.unmount()
  })

  it('FINDING: a silent refresh asked before a filter change and answered after it does not put the old rows back (RED on base)', async () => {
    const held: NetCall[] = []
    let hold = false
    const opened = await openList(listServer({
      'GET /api/admin/articles': (call) => {
        if (hold) { held.push(call); return undefined }
        return listAnswer(ROWS)
      },
    }))
    hold = true
    // Translating one row ends with a silent refresh of the table.
    const row = rowOf(opened, 'Bài 3')
    await click(byText(row, 'button', 'Dịch'))
    await settle()
    void click(byText(row, 'button', 'Tiếng Anh (EN)'))
    await settle()
    const silent = held.at(-1)!
    assert.equal(wire(silent), ARTICLES_QUERY())
    // The officer filters meanwhile; that answer comes first.
    await pickHeld(select(opened, 'Lọc theo trạng thái bài viết'), 'draft')
    held.at(-1)!.respond(listAnswer([article(4, { title: 'Chỉ bản nháp', status: 'draft' })]))
    await settle()
    silent.respond(listAnswer(ROWS))
    await settle()
    assert.deepEqual(shownTitles(opened), ['Chỉ bản nháp'])
    opened.page.unmount()
  })

  // The bulk-translate poll: every 2.5 s a status check, and while a translation runs a silent
  // refresh of the table. The three tests below drive that poll (mock timers).
  const RUNNING = {
    ...IDLE_STATUS, active: true, dbTranslatingCount: 1,
    task: { ...IDLE_STATUS.task, active: true, total: 2, processed: 1, langCode: 'en', langName: 'Tiếng Anh', startedAt: '2026-10-27T01:00:00.000Z' },
  }
  const pollingServer = (held: NetCall[], state: { hold: boolean, rows?: unknown[] }) => listServer({
    'GET /api/admin/articles': (call) => {
      if (state.hold) { held.push(call); return undefined }
      return listAnswer(state.rows ?? ROWS, Number(call.url.searchParams.get('page') ?? 1), 40)
    },
    'GET /api/admin/articles/bulk-translate-status': () => json(RUNNING),
  })

  it('FINDING: of two silent refreshes, the older one answered last does not put its rows back (RED on b061ecc)', async () => {
    mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
    const held: NetCall[] = []
    const state = { hold: false }
    const opened = await openList(pollingServer(held, state))
    state.hold = true
    mock.timers.tick(2500)
    await settle()
    mock.timers.tick(2500)
    await settle()
    const [older, newer] = held.slice(-2)
    assert.ok(older && newer && older !== newer, `two silent refreshes expected, got ${held.map(wire).join(', ')}`)
    newer.respond(listAnswer([article(2, { title: 'Bản mới' })]))
    await settle()
    older.respond(listAnswer([article(1, { title: 'Bản cũ' })]))
    await settle()
    assert.deepEqual(shownTitles(opened), ['Bản mới'])
  })

  it('FINDING: no silent refresh is sent while a load runs; the next one asks for the page and filters of that load (RED on b061ecc)', async () => {
    mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
    const held: NetCall[] = []
    const state = { hold: false }
    const opened = await openList(pollingServer(held, state))
    await fire(findAll(opened.page.root, el => el.tag === 'AdminPagination')[0]!, 'update:page', 3)
    await settle()
    // A filter change starts a load of page 1; its answer is held.
    state.hold = true
    await pickHeld(select(opened, 'Lọc theo trạng thái bài viết'), 'draft')
    const load = held.at(-1)!
    assert.equal(wire(load), ARTICLES_QUERY({ status: 'draft' }))
    // A poll tick while the load runs: the status is asked, the table is not.
    const before = opened.calls.length
    mock.timers.tick(2500)
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire), ['GET /api/admin/articles/bulk-translate-status'])
    load.respond(listAnswer([article(5, { title: 'Nháp trang 1', status: 'draft' })], 1, 20))
    await settle()
    assert.deepEqual(shownTitles(opened), ['Nháp trang 1'])
    // The next tick refreshes what is on screen now: page 1, status=draft — never the old page 3.
    state.hold = false
    const next = opened.calls.length
    mock.timers.tick(2500)
    await settle()
    assert.deepEqual(opened.calls.slice(next).map(wire), ['GET /api/admin/articles/bulk-translate-status', ARTICLES_QUERY({ status: 'draft' })])
  })

  it('FINDING: a silent refresh drops ticked rows that are no longer on screen from the selection (RED on b061ecc)', async () => {
    mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
    const held: NetCall[] = []
    const state: { hold: boolean, rows?: unknown[] } = { hold: false }
    const opened = await openList(pollingServer(held, state))
    await tick(rowOf(opened, 'Bài 4'))
    // (Booleans, not elements: a failing assert would print the whole mini-DOM, parents included.)
    assert.equal(Boolean(bulkBar(opened)), true, 'one row ticked')
    // Bài 4 was deleted elsewhere; the poll's silent refresh no longer lists it.
    state.rows = [ROWS[0]]
    mock.timers.tick(2500)
    await settle()
    assert.deepEqual(shownTitles(opened), ['Bài 3'])
    assert.equal(Boolean(bulkBar(opened)), false, 'a bulk action must not reach a row that is no longer on screen')
  })

  it('comments switch: PUT { commentsEnabled }; a refusal flips it back and shows the server\'s sentence', async () => {
    let refuse = false
    const opened = await openList(listServer({ 'PUT /api/admin/articles/3': () => (refuse ? h3Error(403, 'Bạn không có quyền sửa bài này.') : json({ ok: true })) }))
    const before = opened.calls.length
    await click(byText(rowOf(opened, 'Bài 3'), 'button', 'Đang đóng'))
    await settle()
    assert.deepEqual(sent(opened.calls, before), [{ wire: 'PUT /api/admin/articles/3', body: { commentsEnabled: true } }])
    assert.equal(cells(rowOf(opened, 'Bài 3'))[6], 'Đang mở')
    refuse = true
    await click(byText(rowOf(opened, 'Bài 3'), 'button', 'Đang mở'))
    await settle()
    assert.equal(cells(rowOf(opened, 'Bài 3'))[6], 'Đang mở')
    assert.equal(opened.lastToast('error'), 'Bạn không có quyền sửa bài này.')
    assertOnlyServerSentences(opened)
    opened.page.unmount()
  })

  it('delete: confirms with the title, deletes, reloads the current page', async () => {
    const opened = await openList()
    const before = opened.calls.length
    await click(byText(rowOf(opened, 'Bài 4'), 'button', 'Xóa'))
    await settle()
    assert.equal(opened.confirms.at(-1)?.message, 'Bạn có chắc muốn xóa bài viết "Bài 4"?')
    assert.deepEqual(opened.calls.slice(before).map(wire), ['DELETE /api/admin/articles/4', ARTICLES_QUERY()])
    opened.page.unmount()
  })

  it('bulk translate: status check, POST { ids, langCode, targetStatus }, then a silent refresh and another status check', async () => {
    const opened = await openList()
    await tick(rowOf(opened, 'Bài 3'))
    const before = opened.calls.length
    await click(byText(bulkBar(opened), 'button', 'Dịch sang...'))
    await settle()
    await click(byText(bulkBar(opened), 'button', 'Tiếng Anh (EN)'))
    await settle()
    assert.deepEqual(sent(opened.calls, before), [
      'GET /api/admin/articles/bulk-translate-status',
      { wire: 'POST /api/admin/articles/bulk-translate', body: { ids: [3], langCode: 'en', targetStatus: 'ai_draft' } },
      ARTICLES_QUERY(),
      'GET /api/admin/articles/bulk-translate-status',
    ])
    assert.equal(opened.lastToast('success'), 'Đã xếp lịch dịch 1 bài viết sang 🇬🇧 Tiếng Anh (EN). Hệ thống đang xử lý trong nền!')
    opened.page.unmount()
  })

  it('one row translated: POST …/translations/translate, then a silent refresh', async () => {
    const opened = await openList()
    const before = opened.calls.length
    const row = rowOf(opened, 'Bài 3')
    await click(byText(row, 'button', 'Dịch'))
    await settle()
    await click(byText(row, 'button', 'Tiếng Pháp (FR)'))
    await settle()
    assert.deepEqual(sent(opened.calls, before), [
      'GET /api/admin/articles/bulk-translate-status',
      { wire: 'POST /api/admin/articles/3/translations/translate', body: { langCode: 'fr', targetStatus: 'ai_draft' } },
      ARTICLES_QUERY(),
      'GET /api/admin/articles/bulk-translate-status',
    ])
    opened.page.unmount()
  })

  it('a running bulk translation is polled every 2.5 s with a silent refresh; completion toasts once and stops', async () => {
    mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
    let active = true
    const running = { ...IDLE_STATUS, active: true, task: { ...IDLE_STATUS.task, active: true, total: 2, processed: 1, langCode: 'en', langName: 'Tiếng Anh', startedAt: '2026-10-27T01:00:00.000Z' } }
    const done = { ...IDLE_STATUS, task: { ...running.task, active: false, processed: 2, completedAt: '2026-10-27T01:05:00.000Z' } }
    const opened = await openList(listServer({ 'GET /api/admin/articles/bulk-translate-status': () => json(active ? running : done) }))
    const before = opened.calls.length
    mock.timers.tick(2500)
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire), ['GET /api/admin/articles/bulk-translate-status', ARTICLES_QUERY()])
    active = false
    const next = opened.calls.length
    mock.timers.tick(2500)
    await settle()
    assert.deepEqual(opened.calls.slice(next).map(wire), ['GET /api/admin/articles/bulk-translate-status', ARTICLES_QUERY()])
    assert.equal(opened.lastToast('success'), 'Đã hoàn tất dịch tự động 2 bài viết sang Tiếng Anh!')
    const after = opened.calls.length
    mock.timers.tick(5000)
    await settle()
    assert.equal(opened.calls.length, after, 'the poll stopped')
    opened.page.unmount()
  })

  it('HTML zip: GET export-batch as a blob and download it under a dated name', async () => {
    const opened = await openList()
    await tick(rowOf(opened, 'Bài 3'))
    await tick(rowOf(opened, 'Bài 4'))
    const before = opened.calls.length
    await click(byText(bulkBar(opened), 'button', 'Tải HTML zip'))
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire), ['GET /api/admin/articles/export-batch?ids=3,4'])
    assert.equal(opened.downloads.length, 1)
    assert.match(opened.downloads[0]!.href, /^blob:/)
    assert.match(opened.downloads[0]!.download, /^bai-viet-\d{8}\.zip$/)
    opened.page.unmount()
  })

  it('Google Sheets: POST { ids } and open the sheet the server answered', async () => {
    const opened = await openList()
    await tick(rowOf(opened, 'Bài 3'))
    const before = opened.calls.length
    await click(byText(bulkBar(opened), 'button', 'Google Sheets'))
    await settle()
    assert.deepEqual(sent(opened.calls, before), [{ wire: 'POST /api/admin/articles/export-google', body: { ids: [3] } }])
    assert.deepEqual(opened.opened.at(-1), ['https://docs.google.com/spreadsheets/d/x', '_blank', 'noopener'])
    assert.equal(opened.lastToast('success'), 'Đã tạo 1 bài trên Google Sheets.')
    opened.page.unmount()
  })

  it('"Xuất bản toàn bộ" (from the banner): POST {} with the badge count in the confirm; toast the server counts', async () => {
    const opened = await openList()
    const before = opened.calls.length
    await fire(stub(opened, 'ArticleBulkTranslateBanner'), 'bulkPublishAi')
    await settle()
    assert.match(String(opened.confirms.at(-1)?.message), /^Xuất bản 4 bản dịch AI/)
    assert.deepEqual(sent(opened.calls, before), [
      { wire: 'POST /api/admin/articles/bulk-publish-translations', body: {} },
      ARTICLES_QUERY(),
      'GET /api/admin/articles/translation-stats',
    ])
    assert.equal(opened.lastToast('success'), 'Đã xuất bản 3 bản dịch AI (bỏ qua 1: 1 đang dịch, 0 lỗi).')
    opened.page.unmount()
  })

  it('export and bulk-publish refusals show the server\'s sentence', async () => {
    const opened = await openList(listServer({
      'POST /api/admin/articles/export-google': () => h3Error(400, 'Chưa cấu hình Google Drive OAuth Client. Vào /admin/settings → backup Drive.'),
      'POST /api/admin/articles/bulk-publish-translations': () => h3Error(400, 'Không có bản dịch AI nào sẵn sàng xuất bản (tất cả đang dịch hoặc đã lỗi).'),
    }))
    await tick(rowOf(opened, 'Bài 3'))
    await click(byText(bulkBar(opened), 'button', 'Google Sheets'))
    await settle()
    assert.equal(opened.lastToast('error'), 'Chưa cấu hình Google Drive OAuth Client. Vào /admin/settings → backup Drive.')
    await fire(stub(opened, 'ArticleBulkTranslateBanner'), 'bulkPublishAi')
    await settle()
    assert.equal(opened.lastToast('error'), 'Không có bản dịch AI nào sẵn sàng xuất bản (tất cả đang dịch hoặc đã lỗi).')
    assertOnlyServerSentences(opened)
    opened.page.unmount()
  })

  it('a failed list load shows the server\'s sentence in the alert; "thử lại" asks for page 1 again', async () => {
    let fail = true
    const opened = await openList(listServer({ 'GET /api/admin/articles': () => (fail ? h3Error(403, 'Bạn không có quyền xem bài viết.') : listAnswer(ROWS)) }))
    assert.match(alertText(opened.page), /Bạn không có quyền xem bài viết\./)
    assertOnlyServerSentences(opened)
    fail = false
    const before = opened.calls.length
    await click(byText(findAll(opened.page.root, el => el.props.role === 'alert')[0]!, 'button', 'thử lại'))
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire), [ARTICLES_QUERY()])
    assert.equal(alertText(opened.page), '')
    assert.deepEqual(shownTitles(opened), ['Bài 3', 'Bài 4'])
    opened.page.unmount()
  })
})

// ─── components/admin/articles/ArticleTranslationPanel.vue ───────────────────

const PANEL = 'components/admin/articles/ArticleTranslationPanel.vue'
const translation = (langCode: string, status: string, overrides: Record<string, unknown> = {}) => ({
  id: langCode.charCodeAt(0), articleId: 3, langCode, title: `Title ${langCode}`, excerpt: null, content: '<p>x</p>', status,
  translatedBy: 'ai', translatorId: null, progress: status === 'translating' ? 40 : 100, totalChunks: 1, currentChunk: 1,
  errorMessage: null, createdAt: '2026-10-20T02:00:00.000Z', updatedAt: null, completedAt: null, ...overrides,
})
const LANGUAGES = [
  { code: 'vi', name: 'Tiếng Việt', nativeName: 'Tiếng Việt', isActive: true, isDefault: true },
  { code: 'en', name: 'Tiếng Anh', nativeName: 'English', isActive: true, isDefault: false },
  { code: 'fr', name: 'Tiếng Pháp', nativeName: 'Français', isActive: true, isDefault: false },
  { code: 'zh', name: 'Tiếng Trung', nativeName: '中文', isActive: true, isDefault: false },
  { code: 'ru', name: 'Tiếng Nga', nativeName: 'Русский', isActive: false, isDefault: false },
]

function panelServer(state: { rows: Array<Record<string, unknown>> }, overrides: Record<string, (call: NetCall) => Response | Error | undefined> = {}) {
  return routes({
    'GET /api/admin/articles/3/translations': () => json({ ok: true, items: state.rows }),
    'GET /api/admin/languages': () => json({ ok: true, items: LANGUAGES }),
    'POST /api/admin/articles/3/translations/translate': (call) => {
      const lang = (call.body as { langCode: string }).langCode
      state.rows = [...state.rows.filter(r => r.langCode !== lang), translation(lang, 'translating')]
      return json({ ok: true, message: 'Đã bắt đầu dịch. Vui lòng đợi.' })
    },
    'POST /api/admin/articles/3/translations/translate-all': () => json({ ok: true, queued: 1, languages: ['zh'], message: 'Đã xếp lịch dịch 1 ngôn ngữ còn thiếu trong nền.' }),
    'PUT /api/admin/articles/3/translations/en': () => json({ ok: true }),
    'PATCH /api/admin/articles/3/translations/en/status': () => json({ ok: true }),
    'DELETE /api/admin/articles/3/translations/en': () => json({ ok: true }),
    ...overrides,
  })
}
const openPanel = (state: { rows: Array<Record<string, unknown>> }, overrides?: Record<string, (call: NetCall) => Response | Error | undefined>) =>
  mountAdminPage(PANEL, panelServer(state, overrides), {
    props: { articleId: 3, isNew: false, formTitle: 'Tiêu đề gốc' },
    modules: { '~/components/admin/TinyMceEditor.vue': passthrough('TinyMceEditor') },
  })
const card = (opened: MountedAdminPage, label: string) =>
  findAll(opened.page.root, el => el.tag === 'div' && String(el.props.class).startsWith('rounded-xl border p-4') && findAll(el, h => h.tag === 'h4').some(h => textOf(h) === label))[0]!

describe('components/admin/articles/ArticleTranslationPanel.vue', () => {
  afterEach(() => { unmountAll(); mock.timers.reset() })

  it('mount: the translations and the languages together; one card per active non-Vietnamese language', async () => {
    const opened = await openPanel({ rows: [translation('en', 'published'), translation('fr', 'failed', { title: null })] })
    assert.deepEqual(opened.calls.map(wire), ['GET /api/admin/articles/3/translations', 'GET /api/admin/languages'])
    const labels = findAll(opened.page.root, el => el.tag === 'h4').map(textOf)
    assert.deepEqual(labels, ['Tiếng Anh', 'Tiếng Pháp', 'Tiếng Trung'])
    assert.match(textOf(card(opened, 'Tiếng Anh')), /Đã xuất bản.*Title en/)
    // A failed translation with no `errorMessage` (nullable column) gets the panel's own sentence.
    assert.match(textOf(card(opened, 'Tiếng Pháp')), /Lỗi tạo bản dịch:Không có phản hồi từ AI\./)
    assert.match(textOf(card(opened, 'Tiếng Trung')), /Chưa dịch/)
    assert.match(textOf(opened.page.root), /1\/3 đã xuất bản/)
    opened.page.unmount()
  })

  it('translate one language: POST { langCode, targetStatus }, re-read, poll every 2 s until done', async () => {
    mock.timers.enable({ apis: ['setInterval'] })
    const state = { rows: [translation('en', 'published')] }
    const opened = await openPanel(state)
    const before = opened.calls.length
    await click(byText(card(opened, 'Tiếng Trung'), 'button', 'Dịch bằng AI'))
    await settle()
    assert.deepEqual(sent(opened.calls, before), [
      { wire: 'POST /api/admin/articles/3/translations/translate', body: { langCode: 'zh', targetStatus: 'ai_draft' } },
      'GET /api/admin/articles/3/translations',
    ])
    assert.equal(opened.lastToast('success'), 'Đã bắt đầu dịch sang Tiếng Trung.')
    state.rows = [translation('en', 'published'), translation('zh', 'ai_draft')]
    const next = opened.calls.length
    mock.timers.tick(2000)
    await settle()
    assert.deepEqual(opened.calls.slice(next).map(wire), ['GET /api/admin/articles/3/translations'])
    assert.equal(opened.lastToast('success'), 'Bản dịch AI đã hoàn tất!')
    mock.timers.tick(4000)
    await settle()
    assert.equal(opened.calls.length, next + 1, 'the poll stopped')
    opened.page.unmount()
  })

  it('translate all: POST { targetStatus } and toast the server\'s message', async () => {
    const opened = await openPanel({ rows: [translation('en', 'published')] })
    const before = opened.calls.length
    await click(byText(opened.page.root, 'button', 'Dịch & Xuất bản luôn'))
    await settle()
    assert.deepEqual(sent(opened.calls, before), [
      { wire: 'POST /api/admin/articles/3/translations/translate-all', body: { targetStatus: 'published' } },
      'GET /api/admin/articles/3/translations',
    ])
    assert.equal(opened.lastToast('success'), 'Đã xếp lịch dịch 1 ngôn ngữ còn thiếu trong nền.')
    opened.page.unmount()
  })

  it('edit: the drawer saves PUT …/en with lang/title/excerpt/content (NULL excerpt sent as "")', async () => {
    const opened = await openPanel({ rows: [translation('en', 'published')] })
    await click(byText(card(opened, 'Tiếng Anh'), 'button', 'Sửa'))
    await settle()
    const title = findAll(opened.page.root, el => el.tag === 'input' && el.props.type === 'text')[0]!
    assert.equal(title.model?.value, 'Title en')
    await input(title, 'New title')
    await settle()
    const before = opened.calls.length
    await click(byText(opened.page.root, 'button', 'Lưu bản dịch'))
    await settle()
    assert.deepEqual(sent(opened.calls, before), [
      { wire: 'PUT /api/admin/articles/3/translations/en', body: { lang: 'en', title: 'New title', excerpt: '', content: '<p>x</p>' } },
      'GET /api/admin/articles/3/translations',
    ])
    assert.equal(opened.lastToast('success'), 'Đã lưu bản dịch.')
    opened.page.unmount()
  })

  it('unpublish (PATCH status reviewed) and delete (confirmed DELETE) re-read the list', async () => {
    const opened = await openPanel({ rows: [translation('en', 'published')] })
    let before = opened.calls.length
    await click(byText(card(opened, 'Tiếng Anh'), 'button', 'Gỡ'))
    await settle()
    assert.deepEqual(sent(opened.calls, before), [
      { wire: 'PATCH /api/admin/articles/3/translations/en/status', body: { status: 'reviewed' } },
      'GET /api/admin/articles/3/translations',
    ])
    before = opened.calls.length
    await click(findAll(card(opened, 'Tiếng Anh'), el => el.tag === 'button' && el.props.title === 'Xoá bản dịch này')[0]!)
    await settle()
    assert.equal(opened.confirms.at(-1)?.message, 'Xoá bản dịch Tiếng Anh?')
    assert.deepEqual(opened.calls.slice(before).map(wire), ['DELETE /api/admin/articles/3/translations/en', 'GET /api/admin/articles/3/translations'])
    opened.page.unmount()
  })

  it('FINDING: "Thử lại lỗi (2)" retries both and says 2, not 0 (RED on base)', async () => {
    const state = { rows: [translation('en', 'failed'), translation('fr', 'failed')] }
    const opened = await openPanel(state)
    const before = opened.calls.length
    await click(byText(opened.page.root, 'button', 'Thử lại lỗi (2)'))
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire).filter(line => line.startsWith('POST')), [
      'POST /api/admin/articles/3/translations/translate',
      'POST /api/admin/articles/3/translations/translate',
    ])
    assert.equal(opened.lastToast('success'), 'Đã kích hoạt thử lại cho 2 bản dịch lỗi.')
    opened.page.unmount()
  })

  it('a refused translation shows the server\'s sentence and the card reads "Lỗi" again', async () => {
    const opened = await openPanel({ rows: [translation('en', 'failed', { errorMessage: 'Hết hạn mức AI.' })] }, {
      'POST /api/admin/articles/3/translations/translate': () => h3Error(429, 'Đã vượt hạn mức dịch trong giờ này.'),
    })
    await click(byText(card(opened, 'Tiếng Anh'), 'button', 'Thử lại bản dịch'))
    await settle()
    assert.equal(opened.lastToast('error'), 'Đã vượt hạn mức dịch trong giờ này.')
    assert.match(textOf(card(opened, 'Tiếng Anh')), /Lỗi tạo bản dịch:Hết hạn mức AI\./)
    assertOnlyServerSentences(opened)
    opened.page.unmount()
  })
})

// ─── adminFetch: the blob export needs `responseType` ────────────────────────

describe('adminFetch responseType', () => {
  it('passes responseType through to ofetch: a blob comes back as a Blob, not parsed JSON', async () => {
    installNetwork(() => new Response(new Blob(['PK-zip']), { status: 200, headers: { 'content-type': 'application/json' } }))
    const blob = await adminFetch<Blob>('/api/admin/articles/export-batch?ids=1', { responseType: 'blob' })
    assert.ok(blob instanceof Blob)
    assert.equal(await blob.text(), 'PK-zip')
  })
})
