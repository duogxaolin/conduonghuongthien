/**
 * `/admin/languages` (app/pages/admin/languages/index.vue) — behaviour, written BEFORE the
 * wave3 4.2 split and run on both versions (`LANGUAGES_PAGE_FILE=<original>`).
 *
 * The real page and its real tabs are mounted (tests/_languages-page-harness.ts) and driven
 * through the controls an officer uses: the header buttons, the language cards, the move and
 * the "Tiến trình Dịch AI" dialogs, the translations table. What is checked is what the
 * officer gets — requests (method, path, query, body, and the reloads after them), what the
 * screen says while a request is out (disabled buttons, "Đang …" labels, busy dialogs),
 * toasts and confirm prompts — never the source text.
 *
 * Not repeated here: the translations search box (tests/admin-languages-search-focus.test.ts)
 * and the request-level pins of every action (tests/admin-fetch-rollout.test.ts).
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { click, fire, input, isShown, type MiniElement } from './_sfc-mount.ts'
import {
  alerts, button, buttonsWith, byTitle, card, cardCodes, closeX, dialog, dialogs, findAll, h3Error, HOLD, lastToast, languagesServer,
  OFETCH_LINE, openPage, mountPage, sent, skeletons, tabButton, tableRows, textOf, wire, type NetCall, type PageCtx,
} from './_languages-page-harness.ts'

const MOUNT = ['GET /api/admin/languages', 'GET /api/admin/languages/en/translations', 'GET /api/admin/languages/vi/translations']
const RELOAD_ALL = MOUNT
const header = (ctx: PageCtx, label: string) => buttonsWith(ctx.page, label).find(b => String(b.props.class ?? '').includes('text-xs font-bold cursor-pointer flex items-center gap-1.5'))!
const isDisabled = (el: { props: Record<string, unknown> }) => el.props.disabled === true || el.props.disabled === ''
/**
 * Click without waiting for the handler: one whose request the test HOLDS never settles
 * until the test answers it. A disabled control still throws, as with `click`.
 */
const tap = (el: MiniElement) => { void click(el) }
const iconOf = (el: { children: unknown[] }) => findAll(el as never, n => n.tag === 'i')[0]!

function assertOnlyServerSentences(ctx: PageCtx) {
  for (const t of ctx.toasts) assert.doesNotMatch(t.message, OFETCH_LINE, `toast "${t.message}"`)
  for (const a of alerts(ctx.page)) assert.doesNotMatch(textOf(a), OFETCH_LINE)
}

describe('languages page — loading, empty, error', () => {
  it('mount: the skeleton stands in for the cards until the list answers; then one card per language', async (t) => {
    const server = languagesServer()
    const held: NetCall[] = []
    server.state.override = call => (wire(call) === 'GET /api/admin/languages' && !held.length ? (held.push(call), HOLD) : undefined)
    const ctx = await mountPage(t, server)
    await ctx.settle()
    assert.deepEqual(skeletons(ctx.page), ['Đang tải danh sách ngôn ngữ'])
    assert.equal(cardCodes(ctx.page).length, 0)
    server.answer(held[0]!)
    await ctx.settle()
    assert.deepEqual(ctx.calls.map(wire), MOUNT)
    assert.deepEqual(skeletons(ctx.page), [])
    assert.deepEqual(cardCodes(ctx.page), ['vi', 'en', 'fr', 'lo'])
    assert.match(textOf(card(ctx.page, 'en')), /Còn thiếu 1 key \(67%\)/)
    assert.equal(alerts(ctx.page).length, 0)
  })

  it('no language at all: no card, only the "Thêm ngôn ngữ mới" tile', async (t) => {
    const server = languagesServer()
    server.state.languages = []
    const ctx = await openPage(t, server)
    assert.deepEqual(cardCodes(ctx.page), [])
    assert.ok(findAll(ctx.page.root, el => el.tag === 'span' && textOf(el) === 'Thêm ngôn ngữ mới').length === 1)
    assert.equal(alerts(ctx.page).length, 0)
  })

  it('a failed list load shows the server\'s sentence in role="alert"; "Thử lại" reads the list again', async (t) => {
    const server = languagesServer()
    let fail = true
    server.state.override = call => (fail && wire(call) === 'GET /api/admin/languages' ? h3Error(403, 'Forbidden: Insufficient permissions') : undefined)
    const ctx = await openPage(t, server)
    assert.equal(alerts(ctx.page).length, 1)
    assert.match(textOf(alerts(ctx.page)[0]!), /Forbidden: Insufficient permissions/)
    assert.deepEqual(cardCodes(ctx.page), [], 'no card list under the alert')
    assertOnlyServerSentences(ctx)
    // The alert is the languages tab's own: another tab does not show it.
    await click(tabButton(ctx.page, 'Dịch Toàn Cục'))
    await ctx.settle()
    assert.equal(alerts(ctx.page).length, 0)
    await click(tabButton(ctx.page, 'Ngôn ngữ'))
    await ctx.settle()
    fail = false
    const from = ctx.calls.length
    await click(button(alerts(ctx.page)[0]!, 'Thử lại'))
    await ctx.settle()
    assert.deepEqual(ctx.calls.slice(from).map(wire), ['GET /api/admin/languages'])
    assert.equal(alerts(ctx.page).length, 0)
    assert.deepEqual(cardCodes(ctx.page), ['vi', 'en', 'fr', 'lo'])
  })

  it('a dropped connection shows the page\'s own sentence, never ofetch\'s line', async (t) => {
    const server = languagesServer()
    server.state.override = call => (wire(call) === 'GET /api/admin/languages' ? new TypeError('fetch failed') : undefined)
    const ctx = await openPage(t, server)
    assert.equal(textOf(alerts(ctx.page)[0]!).replace('Thử lại', '').trim(), 'Không thể tải danh sách ngôn ngữ.')
    assertOnlyServerSentences(ctx)
  })

  it('a failed translations load shows its alert in place of the table, under the filters; "Thử lại" reads that list again', async (t) => {
    const server = languagesServer()
    let fail = true
    server.state.override = call => (fail && wire(call) === 'GET /api/admin/languages/en/translations' ? h3Error(404, 'Ngôn ngữ không tồn tại.') : undefined)
    const ctx = await openPage(t, server)
    await click(tabButton(ctx.page, 'Bản dịch UI'))
    await ctx.settle()
    assert.equal(alerts(ctx.page).length, 1)
    assert.match(textOf(alerts(ctx.page)[0]!), /Ngôn ngữ không tồn tại\./)
    assert.equal(findAll(ctx.page.root, el => el.tag === 'select').length, 3, 'the filters stay')
    fail = false
    const from = ctx.calls.length
    await click(button(alerts(ctx.page)[0]!, 'Thử lại'))
    await ctx.settle()
    assert.deepEqual(ctx.calls.slice(from).map(wire), ['GET /api/admin/languages/en/translations'])
    assert.equal(alerts(ctx.page).length, 0)
    assert.equal(tableRows(ctx.page).length, 3)
  })

  it('tabs: "Dịch Toàn Cục" mounts its own tab; the languages skeleton/alert belong to the languages tab only', async (t) => {
    const ctx = await openPage(t)
    const from = ctx.calls.length
    await click(tabButton(ctx.page, 'Dịch Toàn Cục'))
    await ctx.settle()
    assert.equal(findAll(ctx.page.root, el => el.props['data-stub'] === 'UniversalTab').length, 1)
    assert.deepEqual(cardCodes(ctx.page), [])
    assert.deepEqual(ctx.calls.slice(from).map(wire), [], 'the page itself sends nothing for that tab')
    assert.match(String(tabButton(ctx.page, 'Dịch Toàn Cục').props.class), /border-brand-700 text-brand-700/)
  })
})

describe('languages page — header actions', () => {
  it('"Đồng bộ key": disabled and "Đang đồng bộ..." while out; the server\'s sentence; everything reloads', async (t) => {
    const server = languagesServer()
    const held: NetCall[] = []
    server.state.override = call => (wire(call) === 'POST /api/admin/languages/sync' ? (held.push(call), HOLD) : undefined)
    const ctx = await openPage(t, server)
    const from = ctx.calls.length
    tap(header(ctx, 'Đồng bộ key'))
    await ctx.settle()
    const busy = header(ctx, 'Đang đồng bộ...')
    assert.ok(isDisabled(busy))
    assert.match(String(iconOf(busy).props.class), /animate-spin/)
    server.answer(held[0]!)
    await ctx.settle()
    assert.deepEqual(sent(ctx.calls, from), ['POST /api/admin/languages/sync', ...RELOAD_ALL])
    // Lao has no row yet: the server adds its three keys (empty) — its sentence, verbatim.
    assert.equal(lastToast(ctx.toasts, 'success'), 'Đã đồng bộ 3 khóa còn thiếu sang các ngôn ngữ.')
    assert.ok(!isDisabled(header(ctx, 'Đồng bộ key')))
  })

  it('"Đồng bộ key" refused: the server\'s sentence, the button comes back', async (t) => {
    const server = languagesServer()
    server.state.override = call => (wire(call) === 'POST /api/admin/languages/sync' ? h3Error(403, 'Forbidden: Insufficient permissions') : undefined)
    const ctx = await openPage(t, server)
    await click(header(ctx, 'Đồng bộ key'))
    await ctx.settle()
    assert.equal(lastToast(ctx.toasts, 'error'), 'Forbidden: Insufficient permissions')
    assert.ok(!isDisabled(header(ctx, 'Đồng bộ key')))
    assertOnlyServerSentences(ctx)
  })

  it('"Nạp mặc định": asks first; "Hủy" sends nothing; confirmed: disabled "Đang nạp..." while out, the server\'s sentence, then languages + the table reload', async (t) => {
    const server = languagesServer()
    const held: NetCall[] = []
    server.state.override = call => (wire(call) === 'POST /api/admin/languages/seed-default' ? (held.push(call), HOLD) : undefined)
    const ctx = await openPage(t, server)
    let from = ctx.calls.length
    ctx.answers.confirm = false
    await click(header(ctx, 'Nạp mặc định'))
    await ctx.settle()
    assert.deepEqual(ctx.confirms.at(-1), {
      message: 'Hệ thống sẽ nạp lại 6 ngôn ngữ và toàn bộ các bản dịch mặc định (insert-only, không ghi đè dữ liệu bạn đã sửa). Tiếp tục?',
      confirmLabel: 'Nạp bản dịch mặc định',
    })
    assert.deepEqual(ctx.calls.slice(from), [])
    ctx.answers.confirm = true
    tap(header(ctx, 'Nạp mặc định'))
    await ctx.settle()
    const busy = header(ctx, 'Đang nạp...')
    assert.ok(isDisabled(busy))
    from = ctx.calls.length - 1
    server.answer(held[0]!)
    await ctx.settle()
    assert.equal(lastToast(ctx.toasts, 'success'), 'Đã nạp 0 ngôn ngữ và 1 bản dịch mặc định.')
    assert.deepEqual(sent(ctx.calls, from).slice(0, 3), ['POST /api/admin/languages/seed-default', 'GET /api/admin/languages', 'GET /api/admin/languages/en/translations'])
    assert.ok(!isDisabled(header(ctx, 'Nạp mặc định')))
  })

  it('"Làm mới CSDL" reads the three lists again; its icon spins while the language list is out', async (t) => {
    const server = languagesServer()
    const held: NetCall[] = []
    const ctx = await openPage(t, server)
    server.state.override = call => (wire(call) === 'GET /api/admin/languages' ? (held.push(call), HOLD) : undefined)
    const refresh = button(ctx.page, 'Làm mới CSDL')
    const from = ctx.calls.length
    tap(refresh)
    await ctx.settle()
    assert.match(String(iconOf(button(ctx.page, 'Làm mới CSDL')).props.class), /animate-spin/)
    server.answer(held[0]!)
    await ctx.settle()
    assert.deepEqual(ctx.calls.slice(from).map(wire).sort(), [...RELOAD_ALL].sort())
    assert.doesNotMatch(String(iconOf(button(ctx.page, 'Làm mới CSDL')).props.class), /animate-spin/)
  })

  it('"Dịch tất cả còn thiếu" with nothing missing: says so, asks nothing, sends nothing', async (t) => {
    const server = languagesServer()
    server.state.rows.en = [{ group: 'nav', key: 'home', value: 'Home', isAiTranslated: false }, { group: 'nav', key: 'news', value: 'News', isAiTranslated: false }, { group: 'footer', key: 'contact', value: 'Contact', isAiTranslated: false }]
    const ctx = await openPage(t, server)
    const from = ctx.calls.length
    await click(header(ctx, 'Dịch tất cả còn thiếu'))
    await ctx.settle()
    assert.equal(lastToast(ctx.toasts, 'info'), 'Tất cả ngôn ngữ đang hoạt động đã được dịch đầy đủ 100%!')
    assert.equal(ctx.confirms.length, 0)
    assert.deepEqual(ctx.calls.slice(from), [])
  })

  it('"Dịch tất cả còn thiếu": names every active non-default language with gaps; "Hủy" sends nothing; confirmed: each language in turn, then one reload', async (t) => {
    const server = languagesServer()
    server.state.rows.fr![1]!.value = null // fr misses nav.news too
    const ctx = await openPage(t, server)
    let from = ctx.calls.length
    ctx.answers.confirm = false
    await click(header(ctx, 'Dịch tất cả còn thiếu'))
    await ctx.settle()
    assert.deepEqual(ctx.confirms.at(-1), { message: 'Dịch AI tất cả các key còn thiếu cho 2 ngôn ngữ (English, French)?', confirmLabel: 'Dịch bằng AI' })
    assert.deepEqual(ctx.calls.slice(from), [])
    ctx.answers.confirm = true
    from = ctx.calls.length
    await click(header(ctx, 'Dịch tất cả còn thiếu'))
    await ctx.settle()
    assert.deepEqual(sent(ctx.calls, from), [
      'GET /api/admin/languages/en/translations',
      { wire: 'POST /api/admin/languages/ai-translate-chunk', body: { langCode: 'en', langName: 'English', items: [{ group: 'nav', key: 'news', sourceText: 'Tin tức' }] } },
      ...RELOAD_ALL,
      'GET /api/admin/languages/fr/translations',
      { wire: 'POST /api/admin/languages/ai-translate-chunk', body: { langCode: 'fr', langName: 'French', items: [{ group: 'nav', key: 'news', sourceText: 'Tin tức' }] } },
      ...RELOAD_ALL,
      ...RELOAD_ALL,
    ])
    assert.deepEqual(ctx.toasts.filter(x => x.type === 'success').map(x => x.message), ['Đã hoàn tất dịch 1/1 key cho English!', 'Đã hoàn tất dịch 1/1 key cho French!'])
    assert.equal(textOf(dialog(ctx.page).children[0] as never), 'Tiến trình Dịch AI: 🇫🇷 French (fr)')
    assert.ok(!isDisabled(header(ctx, 'Dịch tất cả còn thiếu')))
  })

  it('"Dịch tất cả còn thiếu" while running: disabled "Đang dịch tất cả..."; "Dừng lại" stops after the chunk in flight — the next language is never read', async (t) => {
    const server = languagesServer()
    server.state.rows.fr![1]!.value = null
    const held: NetCall[] = []
    server.state.override = call => (wire(call) === 'POST /api/admin/languages/ai-translate-chunk' ? (held.push(call), HOLD) : undefined)
    const ctx = await openPage(t, server)
    const from = ctx.calls.length
    tap(header(ctx, 'Dịch tất cả còn thiếu'))
    await ctx.settle()
    assert.ok(isDisabled(header(ctx, 'Đang dịch tất cả...')))
    const progress = dialog(ctx.page, 'Tiến trình Dịch AI: 🇬🇧 English (en)')
    assert.equal(progress.props['aria-busy'], 'true')
    await click(button(progress, 'Dừng lại'))
    await ctx.settle()
    assert.match(textOf(dialog(ctx.page)), /⏹ Đã dừng tiến trình/)
    server.answer(held[0]!)
    await ctx.settle()
    assert.deepEqual(ctx.calls.slice(from).map(wire).filter(w => w.includes('/fr/')), [], 'French is never read after "Dừng lại"')
    assert.ok(!isDisabled(header(ctx, 'Dịch tất cả còn thiếu')))
    assert.equal(ctx.toasts.filter(x => x.type === 'success').length, 0, 'no "Đã hoàn tất" for a stopped run')
  })
})

describe('languages page — language cards', () => {
  it('"Hoạt động" turns a language off: PUT isActive false, toast, the list reloads', async (t) => {
    const ctx = await openPage(t)
    const from = ctx.calls.length
    await click(button(card(ctx.page, 'en'), 'Hoạt động'))
    await ctx.settle()
    assert.deepEqual(sent(ctx.calls, from), [{ wire: 'PUT /api/admin/languages/en', body: { isActive: false } }, 'GET /api/admin/languages'])
    assert.equal(lastToast(ctx.toasts, 'success'), 'Đã tắt ngôn ngữ.')
    assert.match(textOf(card(ctx.page, 'en')), /Tắt/)
    await click(button(card(ctx.page, 'en'), 'Tắt'))
    await ctx.settle()
    assert.equal(lastToast(ctx.toasts, 'success'), 'Đã bật ngôn ngữ.')
  })

  it('the star sets the default: PUT isDefault true, toast names the language; the default card has no star and no delete', async (t) => {
    const ctx = await openPage(t)
    assert.equal(byTitle(card(ctx.page, 'vi'), 'Đặt làm mặc định').length, 0)
    const from = ctx.calls.length
    await click(byTitle(card(ctx.page, 'fr'), 'Đặt làm mặc định')[0]!)
    await ctx.settle()
    assert.deepEqual(sent(ctx.calls, from), [{ wire: 'PUT /api/admin/languages/fr', body: { isDefault: true } }, 'GET /api/admin/languages'])
    assert.equal(lastToast(ctx.toasts, 'success'), 'Đã đặt French làm ngôn ngữ mặc định.')
    assert.equal(byTitle(card(ctx.page, 'fr'), 'Xoá ngôn ngữ').length, 0)
  })

  it('delete asks with the language\'s name; "Hủy" sends nothing; confirmed: DELETE, toast, the card is gone; refused: the server\'s sentence', async (t) => {
    const server = languagesServer()
    const ctx = await openPage(t, server)
    let from = ctx.calls.length
    ctx.answers.confirm = false
    await click(byTitle(card(ctx.page, 'fr'), 'Xoá ngôn ngữ')[0]!)
    await ctx.settle()
    assert.deepEqual(ctx.confirms.at(-1), { message: 'Xoá ngôn ngữ "French"? Tất cả bản dịch cho ngôn ngữ này cũng sẽ bị xoá.', confirmLabel: 'Xoá ngôn ngữ', danger: true })
    assert.deepEqual(ctx.calls.slice(from), [])
    ctx.answers.confirm = true
    await click(byTitle(card(ctx.page, 'fr'), 'Xoá ngôn ngữ')[0]!)
    await ctx.settle()
    assert.deepEqual(sent(ctx.calls, from), ['DELETE /api/admin/languages/fr', 'GET /api/admin/languages'])
    assert.equal(lastToast(ctx.toasts, 'success'), 'Đã xoá ngôn ngữ.')
    assert.deepEqual(cardCodes(ctx.page), ['vi', 'en', 'lo'])
    server.state.override = call => (call.method === 'DELETE' ? h3Error(409, 'Ngôn ngữ đang được dùng.') : undefined)
    from = ctx.calls.length
    await click(byTitle(card(ctx.page, 'en'), 'Xoá ngôn ngữ')[0]!)
    await ctx.settle()
    assert.equal(lastToast(ctx.toasts, 'error'), 'Ngôn ngữ đang được dùng.')
    assert.deepEqual(ctx.calls.slice(from).map(wire), ['DELETE /api/admin/languages/en'])
    assertOnlyServerSentences(ctx)
  })

  it('adding a language: the tile opens the form; "Thêm ngôn ngữ" POSTs the trimmed fields, toast, the list reloads; refused: the server\'s sentence', async (t) => {
    const server = languagesServer()
    const ctx = await openPage(t, server)
    await fire(findAll(ctx.page.root, el => el.tag === 'div' && String(el.props.class ?? '').startsWith('rounded-xl border-2 border-dashed'))[0]!, 'click')
    await ctx.settle()
    const fields = findAll(ctx.page.root, el => el.tag === 'input' && el.props.placeholder !== undefined)
    const at = (placeholder: string) => fields.find(f => f.props.placeholder === placeholder)!
    await input(at('vd: ja'), ' JA ')
    await input(at('vd: Japanese'), ' Japanese ')
    await input(at('vd: 日本語'), '日本語')
    await input(at('0'), 4)
    await ctx.settle()
    const from = ctx.calls.length
    await click(button(ctx.page, 'Thêm ngôn ngữ'))
    await ctx.settle()
    assert.deepEqual(sent(ctx.calls, from), [{ wire: 'POST /api/admin/languages', body: { code: 'ja', name: 'Japanese', nativeName: '日本語', displayOrder: 4 } }, 'GET /api/admin/languages'])
    assert.equal(lastToast(ctx.toasts, 'success'), 'Đã thêm ngôn ngữ mới.')
    assert.ok(cardCodes(ctx.page).includes('ja'))
    // Again with the same code: the server refuses, its sentence reaches the officer.
    await fire(findAll(ctx.page.root, el => el.tag === 'div' && String(el.props.class ?? '').startsWith('rounded-xl border-2 border-dashed'))[0]!, 'click')
    await ctx.settle()
    const again = findAll(ctx.page.root, el => el.tag === 'input' && el.props.placeholder !== undefined)
    await input(again.find(f => f.props.placeholder === 'vd: ja')!, 'ja')
    await input(again.find(f => f.props.placeholder === 'vd: Japanese')!, 'Japanese')
    await input(again.find(f => f.props.placeholder === 'vd: 日本語')!, '日本語')
    await ctx.settle()
    await click(button(ctx.page, 'Thêm ngôn ngữ'))
    await ctx.settle()
    assert.equal(lastToast(ctx.toasts, 'error'), 'Mã ngôn ngữ đã tồn tại.')
  })

  it('▼ moves a language down at once, then saves the whole order; ▲ is disabled on the first card, ▼ on the last', async (t) => {
    const ctx = await openPage(t)
    assert.ok(isDisabled(byTitle(card(ctx.page, 'vi'), 'Di chuyển lên trên')[0]!))
    assert.ok(isDisabled(byTitle(card(ctx.page, 'lo'), 'Di chuyển xuống dưới')[0]!))
    const from = ctx.calls.length
    await click(byTitle(card(ctx.page, 'en'), 'Di chuyển xuống dưới')[0]!)
    await ctx.settle()
    assert.deepEqual(sent(ctx.calls, from), [{
      wire: 'POST /api/admin/languages/reorder',
      body: { orders: [{ code: 'vi', displayOrder: 0 }, { code: 'fr', displayOrder: 1 }, { code: 'en', displayOrder: 2 }, { code: 'lo', displayOrder: 3 }] },
    }, 'GET /api/admin/languages'])
    assert.equal(lastToast(ctx.toasts, 'success'), 'Đã cập nhật thứ tự ngôn ngữ thành công!')
    assert.deepEqual(cardCodes(ctx.page), ['vi', 'fr', 'en', 'lo'])
  })

  it('a refused reorder: the server\'s sentence; the list is read again from the server only on success', async (t) => {
    const server = languagesServer()
    server.state.override = call => (wire(call) === 'POST /api/admin/languages/reorder' ? h3Error(400, 'Dữ liệu thứ tự không hợp lệ.') : undefined)
    const ctx = await openPage(t, server)
    const from = ctx.calls.length
    await click(byTitle(card(ctx.page, 'fr'), 'Di chuyển lên trên')[0]!)
    await ctx.settle()
    assert.deepEqual(ctx.calls.slice(from).map(wire), ['POST /api/admin/languages/reorder'])
    assert.equal(lastToast(ctx.toasts, 'error'), 'Dữ liệu thứ tự không hợp lệ.')
  })

  it('the "#n" badge opens the move dialog: one button per position, "Hiện tại" on its own; a position moves and saves; its own position or "Đóng" sends nothing', async (t) => {
    const ctx = await openPage(t)
    assert.equal(dialogs(ctx.page).length, 0)
    await click(byTitle(card(ctx.page, 'en'), 'Bấm để chuyển đổi vị trí thứ tự')[0]!)
    await ctx.settle()
    const move = dialog(ctx.page, '🇬🇧 English — chuyển đến vị trí nào?')
    assert.equal(move.props['data-size'], 'sm')
    assert.match(textOf(move), /Bấm chọn số thứ tự bên dưới để chuyển ngôn ngữ English đến vị trí đó:/)
    const positions = findAll(move, el => el.tag === 'button' && String(el.props.class ?? '').includes('flex-col items-center'))
    // Number above, code (or "Hiện tại") below — two spans, read without a separator.
    assert.deepEqual(positions.map(textOf), ['1VI', '2Hiện tại', '3FR', '4LO'])
    let from = ctx.calls.length
    await click(positions[1]!)
    await ctx.settle()
    assert.equal(dialogs(ctx.page).length, 0, 'its own position closes the dialog')
    assert.deepEqual(ctx.calls.slice(from), [])
    await click(byTitle(card(ctx.page, 'en'), 'Bấm để chuyển đổi vị trí thứ tự')[0]!)
    await ctx.settle()
    await click(button(dialog(ctx.page), 'Đóng'))
    await ctx.settle()
    assert.equal(dialogs(ctx.page).length, 0)
    await click(byTitle(card(ctx.page, 'en'), 'Bấm để chuyển đổi vị trí thứ tự')[0]!)
    await ctx.settle()
    await click(closeX(dialog(ctx.page)))
    await ctx.settle()
    assert.equal(dialogs(ctx.page).length, 0)
    assert.deepEqual(ctx.calls.slice(from), [])
    await click(byTitle(card(ctx.page, 'en'), 'Bấm để chuyển đổi vị trí thứ tự')[0]!)
    await ctx.settle()
    from = ctx.calls.length
    await click(findAll(dialog(ctx.page), el => el.tag === 'button' && textOf(el) === '4LO')[0]!)
    await ctx.settle()
    assert.equal(dialogs(ctx.page).length, 0)
    assert.deepEqual(sent(ctx.calls, from), [{
      wire: 'POST /api/admin/languages/reorder',
      body: { orders: [{ code: 'vi', displayOrder: 0 }, { code: 'fr', displayOrder: 1 }, { code: 'lo', displayOrder: 2 }, { code: 'en', displayOrder: 3 }] },
    }, 'GET /api/admin/languages'])
    assert.deepEqual(cardCodes(ctx.page), ['vi', 'fr', 'lo', 'en'])
  })

  it('"Xem thiếu" opens the table on that language\'s untranslated keys; "Bảng dịch" on all of them — both scroll to the top', async (t) => {
    const ctx = await openPage(t)
    let from = ctx.calls.length
    await click(button(card(ctx.page, 'en'), 'Xem thiếu'))
    await ctx.settle()
    assert.deepEqual(ctx.calls.slice(from).map(wire), ['GET /api/admin/languages/en/translations'])
    assert.equal(findAll(ctx.page.root, el => el.tag === 'select' && el.props['aria-label'] === 'Trạng thái bản dịch')[0]!.props.value, 'untranslated')
    assert.deepEqual(tableRows(ctx.page).map(r => textOf(r.children[0] as never)), ['news'])
    assert.deepEqual(ctx.scrolls, [{ top: 0, behavior: 'smooth' }])
    await click(tabButton(ctx.page, 'Ngôn ngữ'))
    await ctx.settle()
    from = ctx.calls.length
    await click(button(card(ctx.page, 'fr'), 'Bảng dịch'))
    await ctx.settle()
    assert.deepEqual(ctx.calls.slice(from).map(wire), ['GET /api/admin/languages/fr/translations'])
    assert.equal(findAll(ctx.page.root, el => el.tag === 'select' && el.props['aria-label'] === 'Ngôn ngữ')[0]!.props.value, 'fr')
    assert.equal(findAll(ctx.page.root, el => el.tag === 'select' && el.props['aria-label'] === 'Trạng thái bản dịch')[0]!.props.value, 'all')
    assert.equal(tableRows(ctx.page).length, 3)
    assert.equal(ctx.scrolls.length, 2)
  })
})

describe('languages page — the "Tiến trình Dịch AI" dialog', () => {
  async function startOnCard(t: Parameters<typeof openPage>[0], prepare?: (server: ReturnType<typeof languagesServer>) => void) {
    const server = languagesServer()
    prepare?.(server)
    const held: NetCall[] = []
    server.state.override = call => (wire(call) === 'POST /api/admin/languages/ai-translate-chunk' ? (held.push(call), HOLD) : undefined)
    const ctx = await openPage(t, server)
    const from = ctx.calls.length
    tap(button(card(ctx.page, 'en'), 'Dịch AI ('))
    await ctx.settle()
    return { ctx, server, held, from }
  }
  /** 23 missing en keys → three chunks (10 + 10 + 3). */
  const manyMissing = (server: ReturnType<typeof languagesServer>) => {
    for (let i = 1; i <= 22; i++) server.state.rows.vi!.push({ group: 'bulk', key: `k${String(i).padStart(2, '0')}`, value: `Giá trị ${i}`, isAiTranslated: false })
  }

  it('a card\'s "Dịch AI (n)" opens the dialog, busy, its icon spinning; the card button reads "Đang dịch..." and is disabled', async (t) => {
    const { ctx, held, from } = await startOnCard(t, manyMissing)
    const progress = dialog(ctx.page, 'Tiến trình Dịch AI: 🇬🇧 English (en)')
    assert.equal(progress.props['aria-busy'], 'true')
    assert.equal(progress.props['data-icon'], 'fa-solid fa-wand-magic-sparkles animate-spin motion-reduce:animate-none')
    assert.ok(isDisabled(closeX(progress)), '✕ refuses while translating')
    assert.match(textOf(progress), /Đang xử lý\.\.\.0%/)
    assert.match(textOf(progress), /Đã dịch: 0 \/ 23 key/)
    assert.match(textOf(progress), /Đang dịch: news, k01, k02\.\.\./)
    assert.match(textOf(progress), /Chưa có khóa nào được dịch trong phiên này\.\.\./)
    const busyCard = button(card(ctx.page, 'en'), 'Đang dịch...')
    assert.ok(isDisabled(busyCard))
    assert.deepEqual(sent(ctx.calls, from).slice(0, 2), ['GET /api/admin/languages/en/translations', {
      wire: 'POST /api/admin/languages/ai-translate-chunk',
      body: { langCode: 'en', langName: 'English', items: [{ group: 'nav', key: 'news', sourceText: 'Tin tức' }, ...Array.from({ length: 9 }, (_, i) => ({ group: 'bulk', key: `k${String(i + 1).padStart(2, '0')}`, sourceText: `Giá trị ${i + 1}` }))] },
    }])
    assert.equal(held.length, 1)
  })

  it('progress after each chunk; a failed chunk logs its keys as "Lỗi dịch" and the run goes on; finished: "Hoàn tất & Đóng", not busy, toast, reload', async (t) => {
    const { ctx, server, held, from } = await startOnCard(t, manyMissing)
    server.answer(held[0]!)
    await ctx.settle()
    let progress = dialog(ctx.page)
    assert.match(textOf(progress), /43%/)
    assert.match(textOf(progress), /Đã dịch: 10 \/ 23 key/)
    assert.match(textOf(progress), /Nhật ký dịch theo thời gian thực \(10 mục\)/)
    const width = findAll(progress, el => el.tag === 'div' && String(el.props.class ?? '').startsWith('h-full bg-brand-700'))[0]!
    assert.deepEqual(width.props.style, { width: '43%' })
    held[1]!.fail(new TypeError('fetch failed'))
    await ctx.settle()
    progress = dialog(ctx.page)
    assert.match(textOf(progress), /87%/)
    const logLines = findAll(progress, el => el.tag === 'div' && String(el.props.class ?? '').startsWith('px-2 py-1 rounded bg-white border'))
    assert.equal(logLines.length, 20)
    assert.equal(textOf(logLines[0]!), '✗k19:Lỗi dịch')
    assert.match(String(logLines[0]!.props.class), /border-\[#ffebe9\] text-danger/)
    assert.equal(textOf(logLines[19]!), '✓news:AI(en): Tin tức')
    server.answer(held[2]!)
    await ctx.settle()
    progress = dialog(ctx.page)
    assert.equal(progress.props['aria-busy'], undefined)
    assert.equal(progress.props['data-icon'], 'fa-solid fa-wand-magic-sparkles')
    assert.match(textOf(progress), /✓ Hoàn tất bản dịch100%/)
    assert.match(textOf(progress), /Hoàn tất dịch thành công!/)
    assert.equal(buttonsWith(progress, 'Dừng lại').length, 0)
    assert.equal(lastToast(ctx.toasts, 'success'), 'Đã hoàn tất dịch 23/23 key cho English!')
    assert.deepEqual(ctx.calls.slice(from).map(wire).slice(-3), RELOAD_ALL)
    assert.ok(!isDisabled(closeX(progress)))
    await click(button(progress, 'Hoàn tất & Đóng'))
    await ctx.settle()
    assert.equal(dialogs(ctx.page).length, 0)
  })

  it('"Dừng lại": the dialog says so at once and stops being busy; no next chunk; a warning, no "Đã hoàn tất"', async (t) => {
    const { ctx, server, held, from } = await startOnCard(t, manyMissing)
    await click(button(dialog(ctx.page), 'Dừng lại'))
    await ctx.settle()
    let progress = dialog(ctx.page)
    assert.match(textOf(progress), /⏹ Đã dừng tiến trình/)
    assert.equal(progress.props['aria-busy'], undefined)
    assert.equal(buttonsWith(progress, 'Dừng lại').length, 0)
    assert.ok(findAll(progress, el => el.tag === 'button' && textOf(el) === 'Đóng cửa sổ').length === 1)
    server.answer(held[0]!)
    await ctx.settle()
    assert.equal(held.length, 1, 'no second chunk is sent')
    assert.equal(lastToast(ctx.toasts, 'warning'), 'Đã dừng tiến trình dịch AI.')
    assert.equal(ctx.toasts.filter(x => x.type === 'success').length, 0)
    assert.deepEqual(ctx.calls.slice(from).map(wire).slice(-3), RELOAD_ALL)
    progress = dialog(ctx.page)
    assert.match(textOf(progress), /Đã dịch: 10 \/ 23 key/)
    await click(closeX(progress))
    await ctx.settle()
    assert.equal(dialogs(ctx.page).length, 0)
  })

  it('"Đóng cửa sổ" while running hides the dialog; the run goes on in the background and finishes', async (t) => {
    const { ctx, server, held } = await startOnCard(t)
    await click(findAll(dialog(ctx.page), el => el.tag === 'button' && textOf(el) === 'Đóng cửa sổ')[0]!)
    await ctx.settle()
    assert.equal(dialogs(ctx.page).length, 0)
    assert.ok(isDisabled(button(card(ctx.page, 'en'), 'Đang dịch...')))
    server.answer(held[0]!)
    await ctx.settle()
    assert.equal(lastToast(ctx.toasts, 'success'), 'Đã hoàn tất dịch 1/1 key cho English!')
    assert.equal(dialogs(ctx.page).length, 0)
  })

  it('a language with nothing missing: "Tất cả các key đã có bản dịch!", finished at once, an info toast, a reload', async (t) => {
    const server = languagesServer()
    const ctx = await openPage(t, server)
    // The card still offers "Dịch AI (1)"; meanwhile the key got translated elsewhere.
    server.state.rows.en![1]!.value = 'News'
    const from = ctx.calls.length
    await click(button(card(ctx.page, 'en'), 'Dịch AI ('))
    await ctx.settle()
    const progress = dialog(ctx.page)
    assert.match(textOf(progress), /✓ Hoàn tất bản dịch/)
    assert.match(textOf(progress), /Tất cả các key đã có bản dịch!/)
    assert.equal(lastToast(ctx.toasts, 'info'), 'Ngôn ngữ English đã có bản dịch đầy đủ 100%!')
    assert.deepEqual(ctx.calls.slice(from).map(wire), ['GET /api/admin/languages/en/translations', ...RELOAD_ALL])
  })

  it('the language\'s list cannot be read: the server\'s sentence in a toast, the card comes back', async (t) => {
    const server = languagesServer()
    const ctx = await openPage(t, server)
    server.state.override = call => (wire(call) === 'GET /api/admin/languages/en/translations' ? h3Error(403, 'Forbidden: Insufficient permissions') : undefined)
    await click(button(card(ctx.page, 'en'), 'Dịch AI ('))
    await ctx.settle()
    assert.equal(lastToast(ctx.toasts, 'error'), 'Forbidden: Insufficient permissions')
    assert.ok(!isDisabled(button(card(ctx.page, 'en'), 'Dịch AI (')))
    assertOnlyServerSentences(ctx)
  })
})

describe('languages page — the translations table', () => {
  async function onTable(t: Parameters<typeof openPage>[0], server = languagesServer()) {
    const ctx = await openPage(t, server)
    await click(tabButton(ctx.page, 'Bản dịch UI'))
    await ctx.settle()
    return ctx
  }

  it('opening the tab reads the selected language\'s list (the first active language other than vi)', async (t) => {
    const ctx = await openPage(t)
    const from = ctx.calls.length
    await click(tabButton(ctx.page, 'Bản dịch UI'))
    await ctx.settle()
    assert.deepEqual(ctx.calls.slice(from).map(wire), ['GET /api/admin/languages/en/translations'])
    assert.deepEqual(tableRows(ctx.page).map(r => textOf(r.children[0] as never)), ['home', 'news', 'contact'])
    assert.ok(isShown(findAll(ctx.page.root, el => el.tag === 'select')[0]!))
  })

  it('"Sửa" then "Lưu": PUT to the row\'s language, toast, the table reloads', async (t) => {
    const ctx = await onTable(t)
    await click(byTitle(ctx.page, 'Sửa bản dịch')[0]!)
    await ctx.settle()
    for (const box of findAll(ctx.page.root, el => el.tag === 'textarea')) await input(box, 'Homepage')
    await ctx.settle()
    const from = ctx.calls.length
    await click(buttonsWith(ctx.page, 'Lưu').find(b => textOf(b) === 'Lưu')!)
    await ctx.settle()
    assert.deepEqual(sent(ctx.calls, from), [{ wire: 'PUT /api/admin/languages/en/translations', body: { items: [{ group: 'nav', key: 'home', value: 'Homepage' }] } }, 'GET /api/admin/languages/en/translations'])
    assert.equal(lastToast(ctx.toasts, 'success'), 'Đã lưu bản dịch.')
  })

  it('"Dịch AI cho riêng khóa này": disabled while out; the row takes the answer in place, marked AI; toast; the language list reloads', async (t) => {
    const server = languagesServer()
    const held: NetCall[] = []
    server.state.override = call => (wire(call) === 'POST /api/admin/languages/ai-translate-key' ? (held.push(call), HOLD) : undefined)
    const ctx = await onTable(t, server)
    const newsRow = () => tableRows(ctx.page).find(r => textOf(r.children[0] as never) === 'news')!
    const from = ctx.calls.length
    tap(byTitle(newsRow(), 'Dịch AI cho riêng khóa này')[0]!)
    await ctx.settle()
    assert.ok(isDisabled(byTitle(newsRow(), 'Dịch AI cho riêng khóa này')[0]!))
    server.answer(held[0]!)
    await ctx.settle()
    assert.deepEqual(sent(ctx.calls, from), [{
      wire: 'POST /api/admin/languages/ai-translate-key',
      body: { langCode: 'en', langName: 'English', group: 'nav', key: 'news', sourceText: 'Tin tức' },
    }, 'GET /api/admin/languages'])
    assert.equal(lastToast(ctx.toasts, 'success'), 'Đã dịch khóa "news" bằng AI!')
    assert.match(textOf(newsRow()), /AI\(en\): Tin tức/)
    assert.ok(!isDisabled(byTitle(newsRow(), 'Dịch AI cho riêng khóa này')[0]!))
  })

  it('a refused key translation: the server\'s sentence; the row is unchanged', async (t) => {
    const server = languagesServer()
    server.state.override = call => (wire(call) === 'POST /api/admin/languages/ai-translate-key' ? h3Error(502, 'AI không trả về bản dịch cho khóa này — chưa lưu gì.') : undefined)
    const ctx = await onTable(t, server)
    const newsRow = () => tableRows(ctx.page).find(r => textOf(r.children[0] as never) === 'news')!
    await click(byTitle(newsRow(), 'Dịch AI cho riêng khóa này')[0]!)
    await ctx.settle()
    assert.equal(lastToast(ctx.toasts, 'error'), 'AI không trả về bản dịch cho khóa này — chưa lưu gì.')
    assert.doesNotMatch(textOf(newsRow()), /AI\(en\)/)
  })

  it('the table\'s "Dịch AI" runs the batch for the language selected in the table', async (t) => {
    const server = languagesServer()
    server.state.rows.fr![1]!.value = null
    const ctx = await onTable(t, server)
    await fire(findAll(ctx.page.root, el => el.tag === 'select' && el.props['aria-label'] === 'Ngôn ngữ')[0]!, 'change', { target: { value: 'fr' } })
    await ctx.settle()
    const from = ctx.calls.length
    await click(findAll(ctx.page.root, el => el.tag === 'button' && textOf(el) === 'Dịch AI' && String(el.props.class ?? '').includes('px-4 py-2.5'))[0]!)
    await ctx.settle()
    assert.deepEqual(sent(ctx.calls, from).slice(0, 2), ['GET /api/admin/languages/fr/translations', {
      wire: 'POST /api/admin/languages/ai-translate-chunk', body: { langCode: 'fr', langName: 'French', items: [{ group: 'nav', key: 'news', sourceText: 'Tin tức' }] },
    }])
    assert.equal(dialog(ctx.page).props['aria-label'], 'Tiến trình Dịch AI: 🇫🇷 French (fr)')
  })
})
