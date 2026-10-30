/**
 * Wave 3 D-FETCH, lot H: the last two children of the articles list with `$fetch` casts —
 * "Xem nhanh" `components/admin/articles/ArticleQuickViewModal.vue` (2) and "Quét ảnh thumbnail
 * hỏng" `components/admin/articles/ScanThumbnailsModal.vue` (2) — call `adminFetch<T>()` with
 * `ArticleTranslationReadResponse` / `ArticleTranslationStatusResponse` /
 * `ArticleScanThumbnailsResponse` (app/types/admin-articles-api.ts), derived from the handlers.
 *
 * Mounted through the REAL list page (`pages/admin/content/articles/index.vue`,
 * tests/_admin-page-harness.ts) with these two children real and the other three passthrough, over
 * REAL ofetch on one fake network — so the row's language badge, the header's "Quét ảnh hỏng" and
 * the page's `show`/`open` props and its reaction to `status-toggled`/`fixed` are the page's own.
 * `AdminModal` is the harness's `OpenModal` (slots while open); the scan modal's raw `<Teleport>`
 * renders in place. One test renders the quick view with the REAL `AdminModal` (SSR, its footer
 * slot) — what the officer actually gets while a translation loads.
 *
 * Pinned, green on the base (a7f312c1) and after: the quick view's GET, what it shows, the
 * publish / unpublish PATCH and its toast, the list re-read; a failed load closes with the server's
 * sentence (a dropped one the fallback, never ofetch's line); the scan's dry-run POST, its report,
 * the fix POST (ids + chosen cover) after a confirm, the re-scan and the list re-read; refusals.
 *
 * FINDINGS, RED on the base:
 *   - H-2: open Bài 3's translation on a slow connection, close, open Bài 4's — Bài 3's answer
 *     landing later was shown under Bài 4 ("Bài viết gốc: Bài 4", Bài 3's text, the EN label),
 *     and "Xuất bản ngay" then PATCHed Bài 3; landing before Bài 4's answer it ended Bài 4's
 *     loading with Bài 3's text; its late FAILURE toasted and closed Bài 4's dialog;
 *   - H-3: while a translation loads the footer already offers "Xuất bản ngay" (the placeholder's
 *     status is "loading", never "published") — one click published an AI draft nobody had read.
 *     Now a positive `loaded` flag gates the button AND the handler, each with its own test;
 *   - H-4: publish Bài 3's translation, close before the PATCH answers, open Bài 4's — the answer
 *     wrote "published" onto Bài 4's translation on screen. It now updates the translation it was for.
 * The scan modal: no finding (every control is hidden or disabled while it scans or fixes).
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import * as Vue from 'vue'
import { renderToString } from 'vue/server-renderer'

import { click, fire, findAll, input, loadSfc, textOf, VUE_FOR_SFC, type MiniElement } from './_sfc-mount.ts'
import {
  alertText, dropped, h3Error, installNetwork, json, mountAdminPage, OFETCH_LINE, OpenModal, routes, settle, unmountAll, wire,
  type MountedAdminPage, type NetCall, type Responder,
} from './_admin-page-harness.ts'
import { adminFetch } from '../app/composables/adminFetch.ts'
import { errorMessage } from '../app/utils/errorMessage.ts'

afterEach(unmountAll)

type Route = (call: NetCall) => Response | Error | undefined

const LIST = 'pages/admin/content/articles/index.vue'
const article = (id: number, translatedLangs: string) => ({
  id, type: 'news', category: null, categoryId: null, categoryName: null, categoryParentId: null, parentCategoryName: null,
  title: `Bài ${id}`, slug: `bai-${id}`, excerpt: null, status: 'published', thumbnailUrl: null, commentsEnabled: false,
  publishedAt: null, createdAt: '2026-10-20T02:00:00.000Z', updatedAt: null, authorName: 'bientap', viewTotal: 0, translatedLangs,
})
const ROWS = [article(3, 'en:ai_draft'), article(4, 'fr:reviewed')]
const listAnswer = () => json({ ok: true, items: ROWS, pagination: { page: 1, perPage: 15, total: 2, totalPages: 1 } })
/** One `article_translations` row, the whole row as `[lang].get.ts` answers it. */
const translation = (articleId: number, langCode: string, status: string, title: string | null = `Article ${articleId} ${langCode}`) => json({
  ok: true,
  translation: {
    id: articleId * 10, articleId, langCode, title, excerpt: `Sapo ${articleId}`, content: `<p>Body ${articleId}</p>`, status, translatedBy: 'ai',
    translatorId: null, progress: 100, totalChunks: 1, currentChunk: 1, errorMessage: null, createdAt: '2026-10-20T02:00:00.000Z', updatedAt: null, completedAt: null,
  },
})
const scanAnswer = (broken: Array<{ id: number, reason: string }>, extra: Record<string, unknown> = {}) => json({
  ok: true, scanned: 12, brokenCount: broken.length, dryRun: true,
  broken: broken.map(b => ({ id: b.id, title: `Bài ${b.id}`, thumbnailUrl: `https://cdn.example/${b.id}.webp`, reason: b.reason })),
  message: `Đã quét 12 bài — phát hiện ${broken.length} bài ảnh hỏng.`,
  ...extra,
})

function server(overrides: Record<string, Route> = {}): Responder {
  return routes({
    'GET /api/admin/categories': () => json({ ok: true, items: [] }),
    'GET /api/admin/articles/authors': () => json({ ok: true, items: [], orphanCount: 0 }),
    'GET /api/admin/content-types': () => json({ ok: true, items: [{ id: 1, slug: 'news', name: 'Bản tin', isSystem: true }] }),
    'GET /api/admin/articles': () => listAnswer(),
    'GET /api/admin/articles/3/translations/en': () => translation(3, 'en', 'ai_draft'),
    'GET /api/admin/articles/4/translations/fr': () => translation(4, 'fr', 'reviewed'),
    'PATCH /api/admin/articles/3/translations/en/status': () => json({ ok: true }),
    'PATCH /api/admin/articles/4/translations/fr/status': () => json({ ok: true }),
    'POST /api/admin/articles/scan-thumbnails': () => scanAnswer([{ id: 3, reason: 'r2_404' }, { id: 4, reason: 'local_missing' }]),
    ...overrides,
  })
}

const passthrough = (name: string) => ({ default: Vue.defineComponent({ name, setup: () => () => Vue.h('div', { 'data-stub': name }) }) })
/**
 * `<Teleport to="body">` drawn in place: the mini DOM has no `body` to move it to. A Fragment, not a
 * component: the compiler hands a Teleport its children as a BLOCK (not slots), and an optimized
 * patch never re-renders a component whose props did not change — `open` false → true would draw
 * nothing. A Fragment patches those children like the real Teleport does.
 */
const InPlace = Vue.Fragment
const MODULES = {
  ...Object.fromEntries(['ArticleGlobalTranslateModal', 'ArticleBoostStatsPanel', 'ArticleBulkTranslateBanner']
    .map(name => [`~/components/admin/articles/${name}.vue`, passthrough(name)])),
  '~/components/admin/AdminModal.vue': { default: OpenModal },
  vue: { ...VUE_FOR_SFC, Teleport: InPlace },
}
const open = (responder = server()) => mountAdminPage(LIST, responder, { modules: MODULES })

// ─── "Xem nhanh" ─────────────────────────────────────────────────────────────

const quickView = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.props.role === 'dialog' && String(el.props['aria-label']).startsWith('Bản dịch'))[0]
const quickText = (opened: MountedAdminPage) => (quickView(opened) ? textOf(quickView(opened)!) : '')
const quickButton = (opened: MountedAdminPage, label: string) => findAll(quickView(opened)!, el => el.tag === 'button' && textOf(el).trim() === label)[0]
/** The desktop row's language badge (`title="EN: …"`), which opens the quick view. */
async function openBadge(opened: MountedAdminPage, lang: string) {
  void click(findAll(opened.page.root, el => el.tag === 'span' && String(el.props.title ?? '').startsWith(`${lang.toUpperCase()}:`) && 'onClick' in el.props)[0]!)
  await settle()
}
async function closeQuick(opened: MountedAdminPage) {
  await click(quickButton(opened, 'Đóng')!)
  await settle()
}
const quickCalls = (opened: MountedAdminPage, from = 0) => opened.calls.slice(from).filter(c => /\/translations\//.test(c.url.pathname)).map(c => (c.body === undefined ? wire(c) : `${wire(c)} ${JSON.stringify(c.body)}`))
const contentHtml = (opened: MountedAdminPage) => findAll(quickView(opened)!, el => 'innerHTML' in el.props).map(el => el.props.innerHTML).join('')

describe('components/admin/articles/ArticleQuickViewModal.vue (through the articles list)', () => {
  it('a badge opens the translation: its GET, the title, sapo, body, status and the original article', async () => {
    const opened = await open()
    const before = opened.calls.length
    await openBadge(opened, 'en')
    assert.deepEqual(quickCalls(opened, before), ['GET /api/admin/articles/3/translations/en'])
    assert.equal(quickView(opened)!.props['aria-label'], 'Bản dịch Tiếng Anh (EN)')
    const text = quickText(opened)
    assert.match(text, /Bài viết gốc: Bài 3/)
    assert.match(text, /Bản nháp AI/)
    assert.match(text, /Tiêu đề dịch:\s*Article 3 en/)
    assert.match(text, /Sapo 3/)
    assert.equal(contentHtml(opened), '<p>Body 3</p>')
    assert.ok(quickButton(opened, 'Xuất bản ngay'))
  })

  it('"Xuất bản ngay" PATCHes `published`, says so, flips to "Gỡ xuất bản" and re-reads the list; "Gỡ xuất bản" PATCHes `reviewed`', async () => {
    const opened = await open()
    await openBadge(opened, 'en')
    const before = opened.calls.length
    await click(quickButton(opened, 'Xuất bản ngay')!)
    await settle()
    assert.deepEqual(quickCalls(opened, before), ['PATCH /api/admin/articles/3/translations/en/status {"status":"published"}'])
    assert.equal(opened.lastToast('success'), 'Đã xuất bản bản dịch!')
    assert.match(quickText(opened), /Đã xuất bản/)
    assert.ok(opened.calls.slice(before).some(c => wire(c).startsWith('GET /api/admin/articles?')), 'the list is re-read (status-toggled)')
    const again = opened.calls.length
    await click(quickButton(opened, 'Gỡ xuất bản')!)
    await settle()
    assert.deepEqual(quickCalls(opened, again), ['PATCH /api/admin/articles/3/translations/en/status {"status":"reviewed"}'])
    assert.equal(opened.lastToast('success'), 'Đã gỡ xuất bản.')
    assert.ok(quickButton(opened, 'Xuất bản ngay'))
  })

  it('a failed load closes with the server\'s sentence (a dropped one the fallback, never ofetch\'s line); a refused PATCH keeps the status', async () => {
    const missing = await open(server({ 'GET /api/admin/articles/3/translations/en': () => h3Error(404, 'Bản dịch không tồn tại.') }))
    await openBadge(missing, 'en')
    assert.equal(missing.lastToast('error'), 'Bản dịch không tồn tại.')
    assert.equal(quickView(missing), undefined)

    const dead = await open(server({ 'GET /api/admin/articles/3/translations/en': () => dropped() }))
    await openBadge(dead, 'en')
    assert.equal(dead.lastToast('error'), 'Không thể tải bản dịch.')
    assert.doesNotMatch(dead.lastToast('error')!, OFETCH_LINE)

    const refused = await open(server({ 'PATCH /api/admin/articles/3/translations/en/status': () => h3Error(400, 'Trạng thái không hợp lệ.') }))
    await openBadge(refused, 'en')
    await click(quickButton(refused, 'Xuất bản ngay')!)
    await settle()
    assert.equal(refused.lastToast('error'), 'Trạng thái không hợp lệ.')
    assert.match(quickText(refused), /Bản nháp AI/)
  })

  // ─── FINDING H-2: a late answer of a translation no longer open ────────────

  /** Bài 3/EN and Bài 4/FR translation GETs wait for the test (`held`, in request order). */
  async function racing(extra: Record<string, Route> = {}) {
    const held: NetCall[] = []
    const hold: Route = (call) => { held.push(call); return undefined }
    const opened = await open(server({ 'GET /api/admin/articles/3/translations/en': hold, 'GET /api/admin/articles/4/translations/fr': hold, ...extra }))
    await openBadge(opened, 'en')
    await closeQuick(opened)
    await openBadge(opened, 'fr')
    assert.deepEqual(held.map(wire), ['GET /api/admin/articles/3/translations/en', 'GET /api/admin/articles/4/translations/fr'])
    return { opened, held }
  }

  it('FINDING H-2: Bài 3\'s answer landing AFTER Bài 4\'s is not shown under Bài 4 — and "Xuất bản ngay" PATCHes Bài 4', async () => {
    const { opened, held } = await racing()
    held[1]!.respond(translation(4, 'fr', 'reviewed'))
    await settle()
    held[0]!.respond(translation(3, 'en', 'ai_draft'))
    await settle()
    assert.equal(quickView(opened)!.props['aria-label'], 'Bản dịch Tiếng Pháp (FR)')
    assert.match(quickText(opened), /Bài viết gốc: Bài 4/)
    assert.match(quickText(opened), /Article 4 fr/)
    assert.doesNotMatch(quickText(opened), /Article 3 en/)
    const before = opened.calls.length
    await click(quickButton(opened, 'Xuất bản ngay')!)
    await settle()
    assert.deepEqual(quickCalls(opened, before), ['PATCH /api/admin/articles/4/translations/fr/status {"status":"published"}'])
  })

  it('FINDING H-2: Bài 3\'s answer landing BEFORE Bài 4\'s neither shows its text nor ends Bài 4\'s loading', async () => {
    const { opened, held } = await racing()
    held[0]!.respond(translation(3, 'en', 'ai_draft'))
    await settle()
    assert.match(quickText(opened), /Đang tải bản dịch\.\.\./)
    assert.doesNotMatch(quickText(opened), /Article 3 en/)
    held[1]!.respond(translation(4, 'fr', 'reviewed'))
    await settle()
    assert.match(quickText(opened), /Article 4 fr/)
  })

  it('FINDING H-2: Bài 3\'s late FAILURE neither toasts nor closes Bài 4\'s dialog', async () => {
    const { opened, held } = await racing()
    held[0]!.respond(h3Error(404, 'Bản dịch không tồn tại.'))
    await settle()
    held[1]!.respond(translation(4, 'fr', 'reviewed'))
    await settle()
    assert.equal(opened.lastToast('error'), undefined)
    assert.ok(quickView(opened), 'Bài 4\'s dialog is still open')
    assert.match(quickText(opened), /Article 4 fr/)
  })

  // ─── FINDING H-3: publishing a translation nobody has read ─────────────────

  async function loading() {
    const held: NetCall[] = []
    const opened = await open(server({ 'GET /api/admin/articles/3/translations/en': (call) => { held.push(call); return undefined } }))
    await openBadge(opened, 'en')
    assert.match(quickText(opened), /Đang tải bản dịch\.\.\./)
    return { opened, held }
  }

  it('FINDING H-3 (button): while the translation loads, "Xuất bản ngay" is disabled; enabled once it is shown', async () => {
    const { opened, held } = await loading()
    assert.equal(quickButton(opened, 'Xuất bản ngay')!.props.disabled, true)
    held[0]!.respond(translation(3, 'en', 'ai_draft'))
    await settle()
    assert.equal(quickButton(opened, 'Xuất bản ngay')!.props.disabled, false)
  })

  it('FINDING H-3 (handler): a click that slips past the button while it loads sends nothing', async () => {
    const { opened } = await loading()
    const before = opened.calls.length
    await fire(quickButton(opened, 'Xuất bản ngay')!, 'click')
    await settle()
    assert.deepEqual(quickCalls(opened, before), [])
    assert.equal(opened.lastToast('success'), undefined)
  })

  it('FINDING H-3, with the REAL AdminModal (SSR): its footer offers "Xuất bản ngay" while the translation loads — disabled', async () => {
    installNetwork(() => undefined)
    const QuickView = await loadSfc(new URL('../app/components/admin/articles/ArticleQuickViewModal.vue', import.meta.url).pathname, {
      auto: {
        ref: Vue.ref, computed: Vue.computed, watch: Vue.watch, adminFetch, errorMessage,
        useToast: () => ({ success() {}, error() {}, info() {}, warning() {} }),
      },
    })
    const app = Vue.createSSRApp({
      render: () => Vue.h(QuickView, {
        show: true, articleId: 3, articleTitle: 'Bài 3', langCode: 'en', bulkLangs: [{ code: 'en', label: 'Tiếng Anh (EN)', flag: '🇬🇧' }],
      }),
    })
    app.config.warnHandler = () => {}
    const ctx: { teleports?: Record<string, string> } = {}
    await renderToString(app, ctx)
    const html = ctx.teleports?.body ?? ''
    assert.match(html, /role="dialog"/, 'the real AdminModal rendered (teleported to body)')
    assert.match(html, /Đang tải bản dịch\.\.\./)
    const publish = html.match(/<button[^>]*>\s*Xuất bản ngay\s*<\/button>/)?.[0]
    assert.ok(publish, 'the footer offers "Xuất bản ngay" while loading')
    assert.match(publish, /\sdisabled(?:=""|[\s>])/, 'and it is disabled')
  })

  // ─── FINDING H-4: a late PATCH answer of a translation no longer open ──────

  it('FINDING H-4: publish Bài 3, close before the answer, open Bài 4 — the answer does not mark Bài 4 published', async () => {
    const held: NetCall[] = []
    const opened = await open(server({ 'PATCH /api/admin/articles/3/translations/en/status': (call) => { held.push(call); return undefined } }))
    await openBadge(opened, 'en')
    void click(quickButton(opened, 'Xuất bản ngay')!)
    await settle()
    await closeQuick(opened)
    await openBadge(opened, 'fr')
    assert.match(quickText(opened), /Article 4 fr/)
    held[0]!.respond(json({ ok: true }))
    await settle()
    assert.equal(opened.lastToast('success'), 'Đã xuất bản bản dịch!', 'Bài 3 was published — say so')
    assert.match(quickText(opened), /Bản nháp AI/, 'Bài 4\'s translation is still a draft on screen')
    assert.ok(quickButton(opened, 'Xuất bản ngay'))
  })
})

// ─── "Quét ảnh thumbnail hỏng" ───────────────────────────────────────────────

const SCAN = 'POST /api/admin/articles/scan-thumbnails'
const scanDialog = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.props.role === 'dialog' && el.props['aria-label'] === 'Quét ảnh thumbnail hỏng')[0]
const scanText = (opened: MountedAdminPage) => (scanDialog(opened) ? textOf(scanDialog(opened)!) : '')
const scanCalls = (opened: MountedAdminPage, from = 0) => opened.calls.slice(from).filter(c => wire(c) === SCAN).map(c => c.body)
const scanButton = (opened: MountedAdminPage, label: string | RegExp) => findAll(scanDialog(opened)!, el => el.tag === 'button' && (typeof label === 'string' ? textOf(el).trim() === label : label.test(textOf(el))))[0]
async function openScan(opened: MountedAdminPage) {
  await click(findAll(opened.page.root, el => el.tag === 'button' && textOf(el).includes('Quét ảnh hỏng'))[0]!)
  await settle()
}
const rowBox = (opened: MountedAdminPage, id: number) => findAll(scanDialog(opened)!, el => el.tag === 'input' && el.props['aria-label'] === `Chọn bài: Bài ${id}`)[0]!
const tick = (el: MiniElement, checked: boolean) => fire(el, 'change', { target: { checked } })

describe('components/admin/articles/ScanThumbnailsModal.vue (through the articles list)', () => {
  it('opening scans (dry run): the count, the broken rows with their reason', async () => {
    const opened = await open()
    const before = opened.calls.length
    await openScan(opened)
    assert.deepEqual(scanCalls(opened, before), [{ dryRun: true }])
    const text = scanText(opened)
    assert.match(text, /Đã quét: 12 bài/)
    assert.match(text, /Ảnh hỏng: 2/)
    assert.match(text, /Bài 3\s*https:\/\/cdn\.example\/3\.webp[\s\S]*R2 404/)
    assert.match(text, /Bài 4\s*https:\/\/cdn\.example\/4\.webp[\s\S]*File local thiếu/)
    assert.equal(alertText(opened.page), '')
  })

  it('fixing: the ticked ids and the chosen cover, after a confirm; the toast, the list re-read and a re-scan', async () => {
    let fixed = false
    const opened = await open(server({
      [SCAN]: call => ((call.body as { dryRun: boolean }).dryRun
        ? scanAnswer(fixed ? [] : [{ id: 3, reason: 'r2_404' }, { id: 4, reason: 'local_missing' }])
        : (fixed = true, scanAnswer([], { dryRun: false, fixedCount: 1, defaultCover: '/assets/hero_banner.jpg', message: 'Đã sửa 1 bài.' }))),
    }))
    await openScan(opened)
    await tick(rowBox(opened, 4), true)
    await input(findAll(scanDialog(opened)!, el => el.tag === 'select')[0]!, '/assets/hero_banner.jpg')
    const before = opened.calls.length
    await click(scanButton(opened, /Thay 1 bài đã chọn/)!)
    await settle()
    assert.match(String(opened.confirms.at(-1)), /Sửa 1 bài viết — đổi thumbnail_url sang "\/assets\/hero_banner\.jpg"/)
    assert.deepEqual(scanCalls(opened, before), [{ dryRun: false, fixIds: [4], defaultCover: '/assets/hero_banner.jpg' }, { dryRun: true }])
    assert.equal(opened.lastToast('success'), 'Đã sửa 1 bài viết.')
    assert.ok(opened.calls.slice(before).some(c => wire(c).startsWith('GET /api/admin/articles?')), 'the list is re-read (fixed)')
    assert.match(scanText(opened), /Tất cả ảnh thumbnail đều tốt/)
  })

  it('"Chọn tất cả" ticks every row; a declined confirm sends nothing; a fix that changed nothing says the server\'s sentence and re-scans', async () => {
    const opened = await open(server({
      [SCAN]: call => ((call.body as { dryRun: boolean }).dryRun
        ? scanAnswer([{ id: 3, reason: 'r2_404' }, { id: 4, reason: 'local_missing' }])
        : scanAnswer([], { dryRun: false, fixedCount: 0, message: 'Không có bài nào được sửa (thumbnail đã đúng hoặc id không hợp lệ).' })),
    }))
    await openScan(opened)
    await fire(findAll(scanDialog(opened)!, el => el.tag === 'input' && el.props['aria-label'] === 'Chọn tất cả')[0]!, 'change')
    await settle()
    assert.ok(scanButton(opened, /Thay 2 bài đã chọn/))
    opened.answers.confirm = false
    const before = opened.calls.length
    await click(scanButton(opened, /Thay 2 bài đã chọn/)!)
    await settle()
    assert.deepEqual(scanCalls(opened, before), [])
    opened.answers.confirm = true
    await click(scanButton(opened, /Thay 2 bài đã chọn/)!)
    await settle()
    assert.deepEqual(scanCalls(opened, before), [{ dryRun: false, fixIds: [3, 4], defaultCover: '/assets/default_cover_light.png' }, { dryRun: true }])
    assert.equal(opened.lastToast('info'), 'Không có bài nào được sửa (thumbnail đã đúng hoặc id không hợp lệ).')
  })

  it('a refused scan: the server\'s sentence in role="alert" and as a toast, "Thử lại" scans again; a dropped one the fallback; a refused fix says the server\'s sentence', async () => {
    let refuse = true
    const opened = await open(server({ [SCAN]: () => (refuse ? h3Error(409, 'Một lượt quét đang chạy.') : scanAnswer([{ id: 3, reason: 'r2_404' }])) }))
    await openScan(opened)
    assert.match(alertText(opened.page), /Một lượt quét đang chạy\./)
    assert.equal(opened.lastToast('error'), 'Một lượt quét đang chạy.')
    refuse = false
    await click(scanButton(opened, 'Thử lại')!)
    await settle()
    assert.equal(alertText(opened.page), '')
    assert.match(scanText(opened), /Ảnh hỏng: 1/)

    const dead = await open(server({ [SCAN]: () => dropped() }))
    await openScan(dead)
    assert.match(alertText(dead.page), /Lỗi quét ảnh thumbnail/)
    assert.doesNotMatch(alertText(dead.page), OFETCH_LINE)

    const blocked = await open(server({ [SCAN]: call => ((call.body as { dryRun: boolean }).dryRun ? scanAnswer([{ id: 3, reason: 'r2_404' }]) : h3Error(409, 'Đang khôi phục CSDL — thử lại sau.')) }))
    await openScan(blocked)
    await tick(rowBox(blocked, 3), true)
    await click(scanButton(blocked, /Thay 1 bài đã chọn/)!)
    await settle()
    assert.equal(blocked.lastToast('error'), 'Đang khôi phục CSDL — thử lại sau.')
  })

  it('while it scans the dialog cannot be closed (the × is disabled, "close" does nothing) — no answer can land on a closed or reopened dialog', async () => {
    const held: NetCall[] = []
    const opened = await open(server({ [SCAN]: (call) => { held.push(call); return undefined } }))
    await openScan(opened)
    const cross = findAll(scanDialog(opened)!, el => el.tag === 'button' && 'disabled' in el.props)[0]!
    assert.equal(cross.props.disabled, true)
    await fire(cross, 'click')
    await settle()
    assert.ok(scanDialog(opened), 'still open')
    held[0]!.respond(scanAnswer([]))
    await settle()
    assert.equal(findAll(scanDialog(opened)!, el => el.tag === 'button' && 'disabled' in el.props)[0]!.props.disabled, false)
  })
})
