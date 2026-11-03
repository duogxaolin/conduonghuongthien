/**
 * Wave 3 D-FETCH, batch C: the chatbot content page — `pages/admin/chatbot/knowledge/index.vue`
 * (6 `$fetch` casts) and its small-talk tab `components/admin/ChatbotSmallTalkPanel.vue` (5) —
 * call `adminFetch<T>()` with response types derived from the handlers
 * (app/types/admin-chatbot-api.ts and the row types of app/types/admin-api.ts).
 *
 * The REAL page/panel — `<script setup>` and template — is mounted (tests/_admin-page-harness.ts)
 * over REAL ofetch on a fake network. Pinned, green before and after the conversion:
 *   - the exact requests of the mount, of every filter and page change, and of every action
 *     (method, path, query — empty filters included —, body, the FormData of an import),
 *     the confirm wording that gates them, and the reloads after them;
 *   - a failure shows the sentence the SERVER wrote, never ofetch's `[GET] "…"` line;
 *   - the optimistic quick-question checkbox goes back when the save fails.
 *
 * FINDINGS, RED on the base (9b4821a):
 *   - both lists had no notion of "the latest request": the knowledge list reloads on every
 *     keystroke in "Chủ đề" and on each select, the small-talk list on its two selects, and
 *     an older answer landing last replaced the newer filter's rows (and a stale failure
 *     replaced them with an error) under the newer filter's controls. Now only the latest
 *     request writes rows, pagination, error and loading — the ticket pattern of the
 *     articles list (batch B, docs/decisions/fetch-rollout-d-fetch.md);
 *   - a failed load showed the alert AND the empty state under it — "Chưa có mục kiến thức
 *     nào." / "Không có kết quả phù hợp." for a list that was never read;
 *   - knowledge "Xuất bản"/"Lưu trữ" without a server sentence (dropped connection) toasted
 *     "Đã xảy ra lỗi.": the `|| \`Không thể ${verb}…\`` meant to name the action was dead code,
 *     `errorMessage()` never returns ''. It now says which action failed;
 *   - "Tải file mẫu" refused (no `create` permission) toasted "Không thể tải tệp mẫu." instead
 *     of the server's sentence: with `responseType: 'blob'` ofetch reads the JSON error body
 *     as a Blob too, so `errorMessage()` found no `data.statusMessage`. `adminFetch` now
 *     parses a JSON error body of a non-JSON request (tests/admin-fetch-error-body.test.ts);
 *   - small-talk: saving an EDIT reloaded page 1 — `closeEditor()` cleared `editing` before
 *     `load(editing.value ? page.value : 1)` read it — so editing a row on page 3 threw the
 *     officer back to page 1. It now stays on the page.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { byText, click, findAll, fire, input, textOf, type MiniElement } from './_sfc-mount.ts'
import {
  alertText, buttons, dropped, h3Error, json, mountAdminPage, OFETCH_LINE, routes, sent, settle, unmountAll, wire,
  type MountedAdminPage, type NetCall,
} from './_admin-page-harness.ts'

afterEach(unmountAll)

type Route = (call: NetCall) => Response | Error | undefined

function assertOnlyServerSentences(opened: MountedAdminPage) {
  for (const t of opened.toasts) assert.doesNotMatch(t.message, OFETCH_LINE, `toast "${t.message}"`)
  assert.doesNotMatch(alertText(opened.page), OFETCH_LINE)
}
const screen = (opened: MountedAdminPage) => textOf(opened.page.root)
const selects = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'select')
/** The desktop table row with a cell starting with `text` (a question). */
const rowOf = (opened: MountedAdminPage, text: string): MiniElement => {
  const found = findAll(opened.page.root, el => el.tag === 'tr' && findAll(el, td => td.tag === 'td').some(td => textOf(td).startsWith(text)))
  assert.equal(found.length, 1, `expected one row for "${text}", found ${found.length}`)
  return found[0]!
}
/** The one button of `scope` whose whole text is `label` ("Nhập" next to "Nhập từ Excel"). */
const button = (scope: MiniElement, label: string) => {
  const found = findAll(scope, el => el.tag === 'button' && textOf(el) === label)
  assert.equal(found.length, 1, `expected one "${label}" button, found ${found.length}`)
  return found[0]!
}
const pager = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'AdminPagination')[0]!
const listQuery = (call: NetCall) => Object.fromEntries(call.url.searchParams)

// ─── pages/admin/chatbot/knowledge/index.vue ─────────────────────────────────

const KNOWLEDGE = 'pages/admin/chatbot/knowledge/index.vue'
const KB_URL = '/api/admin/chatbot/knowledge'

const kbRow = (id: number, over: Record<string, unknown> = {}) => ({
  id, canonicalQuestion: `Câu hỏi số ${id}`, approvedAnswer: 'Trả lời', topic: 'tai-hoa-nhap', sourceLabel: null, sourceUrl: null,
  sourceReference: null, internalNotes: null, status: 'draft', priority: 0, isQuickQuestion: false, updatedAt: null,
  aliases: [], keywords: [], ...over,
})
const kbList = (items: unknown[], page = 1, totalPages = 1) => json({ ok: true, items, pagination: { page, perPage: 15, total: items.length + (totalPages - 1) * 15, totalPages } })
const KB_ROWS = [kbRow(11), kbRow(12, { status: 'published', isQuickQuestion: true, updatedAt: '2026-10-20T02:00:00.000Z' })]

function kbServer(overrides: Record<string, Route> = {}) {
  return routes({
    [`GET ${KB_URL}`]: () => kbList(KB_ROWS, 1, 3),
    [`PUT ${KB_URL}/11`]: () => json({ ok: true, item: kbRow(11, { isQuickQuestion: true }) }),
    [`POST ${KB_URL}/11/publish`]: () => json({ ok: true, item: kbRow(11, { status: 'published' }) }),
    [`POST ${KB_URL}/12/archive`]: () => json({ ok: true, item: kbRow(12, { status: 'archived' }) }),
    [`DELETE ${KB_URL}/11`]: () => json({ ok: true }),
    [`GET ${KB_URL}/template`]: () => new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), { status: 200, headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } }),
    [`POST ${KB_URL}/import`]: () => json({
      ok: true, total: 3, imported: 2, published: 0, skipped: 1,
      errors: [{ stage: 'parse', row: 4, endRow: 5, code: 'missing_answer', message: 'Thiếu câu trả lời.', raw: { stt: '3', question: 'Hỏi gì?', answer: '', note: '' }, truncatedFields: [] }],
    }),
    ...overrides,
  })
}
const EMPTY_FILTERS = { perPage: '15', search: '', topic: '', status: '', quick: '' }

describe('pages/admin/chatbot/knowledge/index.vue', () => {
  it('mount: page 1 with every filter sent empty; NULL `updatedAt` reads "—"', async () => {
    const opened = await mountAdminPage(KNOWLEDGE, kbServer())
    assert.deepEqual(opened.calls.map(wire), [`GET ${KB_URL}?page=1&perPage=15&search&topic&status&quick`])
    const cells = findAll(rowOf(opened, 'Câu hỏi số 11'), el => el.tag === 'td').map(textOf)
    assert.deepEqual(cells.slice(1, 6), ['Câu hỏi số 11', 'tai-hoa-nhap', '◐ Bản nháp', 'Chưa hiển thị', '—'])
    assert.equal(findAll(rowOf(opened, 'Câu hỏi số 12'), el => el.tag === 'td').map(textOf)[5], new Date('2026-10-20T02:00:00.000Z').toLocaleDateString('vi-VN'))
    assert.doesNotMatch(screen(opened), /Invalid Date|null|undefined/)
  })

  // Batch D: what `selection.keepOnly(visibleIds)` does, run — the regex in
  // tests/admin-bulk-selection-ui.test.ts only proves the call is written.
  it('a reload narrows the bulk selection to the rows on screen: a ticked row on page 1 is not deletable from page 2', async () => {
    const opened = await mountAdminPage(KNOWLEDGE, kbServer({
      [`GET ${KB_URL}`]: call => (call.url.searchParams.get('page') === '2' ? kbList([kbRow(31)], 2, 3) : kbList(KB_ROWS, 1, 3)),
    }))
    const tickBox = findAll(rowOf(opened, 'Câu hỏi số 11'), el => el.tag === 'input' && String(el.props['aria-label']).startsWith('Chọn mục'))[0]!
    await fire(tickBox, 'change')
    await settle()
    assert.equal(findAll(opened.page.root, el => el.tag === 'AdminBulkActionBar')[0]?.props.count, 1)
    await fire(pager(opened), 'update:page', 2)
    await settle()
    assert.equal(findAll(opened.page.root, el => el.tag === 'AdminBulkActionBar').length, 0, 'row 11 is still selected on page 2')
  })

  it('filters and pages: a select reloads page 1 with it; the pager and "Lọc" ask for their page', async () => {
    const opened = await mountAdminPage(KNOWLEDGE, kbServer())
    const before = opened.calls.length
    await input(selects(opened)[0]!, 'published')
    await settle()
    await fire(pager(opened), 'update:page', 3)
    await settle()
    await input(findAll(opened.page.root, el => el.tag === 'input' && el.props.type === 'search')[0]!, 'tiền án')
    await click(byText(opened.page.root, 'button', 'Lọc'))
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(listQuery), [
      { page: '1', ...EMPTY_FILTERS, status: 'published' },
      { page: '3', ...EMPTY_FILTERS, status: 'published' },
      { page: '1', ...EMPTY_FILTERS, status: 'published', search: 'tiền án' },
    ])
  })

  it('FINDING: two filter changes in flight — the older answer landing last does not replace the newer rows', async () => {
    const pending: NetCall[] = []
    const opened = await mountAdminPage(KNOWLEDGE, routes({
      [`GET ${KB_URL}`]: call => { if (!call.url.searchParams.get('status')) return kbList(KB_ROWS); pending.push(call); return undefined },
    }))
    await input(selects(opened)[0]!, 'published')
    await settle()
    await input(selects(opened)[0]!, 'archived')
    await settle()
    assert.deepEqual(pending.map(call => call.url.searchParams.get('status')), ['published', 'archived'])
    pending[1]!.respond(kbList([kbRow(30, { status: 'archived', canonicalQuestion: 'Mục đã lưu trữ' })]))
    await settle()
    pending[0]!.respond(kbList([kbRow(20, { status: 'published', canonicalQuestion: 'Mục đã xuất bản' })]))
    await settle()
    assert.match(screen(opened), /Mục đã lưu trữ/)
    assert.doesNotMatch(screen(opened), /Mục đã xuất bản/, 'the "published" answer is shown under the "archived" filter')
  })

  it('FINDING: a superseded request\'s failure does not replace the newer rows with an error; nor does its loading end', async () => {
    const pending: NetCall[] = []
    const opened = await mountAdminPage(KNOWLEDGE, routes({
      [`GET ${KB_URL}`]: call => { if (!call.url.searchParams.get('status')) return kbList(KB_ROWS); pending.push(call); return undefined },
    }))
    await input(selects(opened)[0]!, 'published')
    await settle()
    await input(selects(opened)[0]!, 'archived')
    await settle()
    // 403, not 5xx: ofetch retries a GET once on 5xx, which would keep this request in flight.
    pending[0]!.respond(h3Error(403, 'Bạn không có quyền lọc theo trạng thái này.'))
    await settle()
    assert.ok(findAll(opened.page.root, el => el.tag === 'SkeletonTable').length === 1, 'the newer request is still loading')
    assert.equal(alertText(opened.page), '')
    pending[1]!.respond(kbList([kbRow(30, { status: 'archived', canonicalQuestion: 'Mục đã lưu trữ' })]))
    await settle()
    assert.equal(alertText(opened.page), '')
    assert.match(screen(opened), /Mục đã lưu trữ/)
  })

  it('load failure: the server\'s sentence + "thử lại" (page 1); FINDING: no empty state under the alert', async () => {
    let answer: () => Response | Error = () => h3Error(403, 'Bạn không có quyền xem kho kiến thức.')
    const opened = await mountAdminPage(KNOWLEDGE, routes({ [`GET ${KB_URL}`]: () => answer() }))
    assert.match(alertText(opened.page), /Bạn không có quyền xem kho kiến thức\./)
    assert.doesNotMatch(screen(opened), /Chưa có mục kiến thức nào|Không có kết quả phù hợp/, 'a list that was never read is not "empty"')
    assertOnlyServerSentences(opened)
    answer = () => kbList(KB_ROWS)
    const before = opened.calls.length
    await click(byText(opened.page.root, 'button', 'thử lại'))
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(listQuery), [{ page: '1', ...EMPTY_FILTERS }])
    assert.equal(alertText(opened.page), '')
    assert.match(screen(opened), /Câu hỏi số 11/)

    const offline = await mountAdminPage(KNOWLEDGE, routes({ [`GET ${KB_URL}`]: () => dropped() }))
    assert.match(alertText(offline.page), /Không thể tải kho kiến thức\./)
    assertOnlyServerSentences(offline)
    const empty = await mountAdminPage(KNOWLEDGE, routes({ [`GET ${KB_URL}`]: () => kbList([]) }))
    assert.match(screen(empty), /Chưa có mục kiến thức nào\./)
  })

  it('quick question: optimistic PUT {isQuickQuestion}; a refusal puts the box back and says why', async () => {
    const opened = await mountAdminPage(KNOWLEDGE, kbServer())
    const box = () => findAll(rowOf(opened, 'Câu hỏi số 11'), el => el.tag === 'input' && String(el.props['aria-label']).startsWith('Bật/tắt'))[0]!
    const before = opened.calls.length
    await fire(box(), 'change')
    await settle()
    assert.deepEqual(sent(opened.calls, before), [{ wire: `PUT ${KB_URL}/11`, body: { isQuickQuestion: true } }])
    assert.equal(box().props.checked, true)
    assert.equal(opened.lastToast('success'), 'Đã đưa vào câu hỏi nhanh.')

    const refused = await mountAdminPage(KNOWLEDGE, kbServer({ [`PUT ${KB_URL}/11`]: () => h3Error(400, 'Câu hỏi nhanh tối đa 8 mục.') }))
    const refusedBox = () => findAll(rowOf(refused, 'Câu hỏi số 11'), el => el.tag === 'input' && String(el.props['aria-label']).startsWith('Bật/tắt'))[0]!
    await fire(refusedBox(), 'change')
    await settle()
    assert.equal(refusedBox().props.checked, false, 'the checkbox goes back')
    assert.equal(refused.lastToast('error'), 'Câu hỏi nhanh tối đa 8 mục.')
    assertOnlyServerSentences(refused)
  })

  it('publish / archive / delete: confirm wording, the request, the toast, a reload of the current page', async () => {
    const opened = await mountAdminPage(KNOWLEDGE, kbServer())
    await fire(pager(opened), 'update:page', 2)
    await settle()
    let before = opened.calls.length
    await click(buttons(rowOf(opened, 'Câu hỏi số 11'), 'Xuất bản')[0]!)
    await settle()
    assert.deepEqual(opened.confirms.at(-1), { message: 'Bạn có chắc muốn xuất bản mục này?', confirmLabel: 'Xuất bản' })
    assert.deepEqual(opened.calls.slice(before).map(wire), [`POST ${KB_URL}/11/publish`, `GET ${KB_URL}?page=2&perPage=15&search&topic&status&quick`])
    assert.equal(opened.lastToast('success'), 'Đã xuất bản mục kiến thức.')

    before = opened.calls.length
    await click(buttons(rowOf(opened, 'Câu hỏi số 12'), 'Lưu trữ')[0]!)
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire).slice(0, 1), [`POST ${KB_URL}/12/archive`])
    assert.equal(opened.lastToast('success'), 'Đã lưu trữ mục kiến thức.')

    opened.answers.confirm = false
    before = opened.calls.length
    await click(buttons(rowOf(opened, 'Câu hỏi số 11'), 'Xóa')[0]!)
    await settle()
    assert.equal(opened.calls.length, before, 'declined → nothing sent')
    opened.answers.confirm = true
    await click(buttons(rowOf(opened, 'Câu hỏi số 11'), 'Xóa')[0]!)
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire), [`DELETE ${KB_URL}/11`, `GET ${KB_URL}?page=2&perPage=15&search&topic&status&quick`])
    assert.equal(opened.confirms.at(-1)?.title, 'Xóa mục kiến thức')
    assert.equal(opened.lastToast('success'), 'Đã xóa mục kiến thức.')
  })

  it('publish refused: the server\'s sentence; FINDING: with none (dropped connection), the toast names the action', async () => {
    const refused = await mountAdminPage(KNOWLEDGE, kbServer({ [`POST ${KB_URL}/11/publish`]: () => h3Error(400, 'Cần nguồn tham khảo trước khi xuất bản.') }))
    await click(buttons(rowOf(refused, 'Câu hỏi số 11'), 'Xuất bản')[0]!)
    await settle()
    assert.equal(refused.lastToast('error'), 'Cần nguồn tham khảo trước khi xuất bản.')
    const offline = await mountAdminPage(KNOWLEDGE, kbServer({ [`POST ${KB_URL}/11/publish`]: () => dropped(), [`POST ${KB_URL}/12/archive`]: () => dropped() }))
    await click(buttons(rowOf(offline, 'Câu hỏi số 11'), 'Xuất bản')[0]!)
    await settle()
    assert.equal(offline.lastToast('error'), 'Không thể xuất bản mục kiến thức.')
    await click(buttons(rowOf(offline, 'Câu hỏi số 12'), 'Lưu trữ')[0]!)
    await settle()
    assert.equal(offline.lastToast('error'), 'Không thể lưu trữ mục kiến thức.')
    assertOnlyServerSentences(offline)
    const deleteRefused = await mountAdminPage(KNOWLEDGE, kbServer({ [`DELETE ${KB_URL}/11`]: () => h3Error(404, 'Knowledge entry not found') }))
    await click(buttons(rowOf(deleteRefused, 'Câu hỏi số 11'), 'Xóa')[0]!)
    await settle()
    assert.equal(deleteRefused.lastToast('error'), 'Knowledge entry not found')
  })

  it('template: a blob GET saved as mau-nhap-kho-kien-thuc.xlsx; FINDING: a refusal toasts the server\'s sentence', async () => {
    const opened = await mountAdminPage(KNOWLEDGE, kbServer())
    await click(byText(opened.page.root, 'button', 'Nhập từ Excel'))
    await settle()
    const before = opened.calls.length
    await click(byText(opened.page.root, 'button', 'Tải file mẫu (.xlsx)'))
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire), [`GET ${KB_URL}/template`])
    assert.equal(opened.downloads.length, 1)
    assert.equal(opened.downloads[0]!.download, 'mau-nhap-kho-kien-thuc.xlsx')
    assert.match(opened.downloads[0]!.href, /^blob:/)

    const refused = await mountAdminPage(KNOWLEDGE, kbServer({ [`GET ${KB_URL}/template`]: () => h3Error(403, 'Bạn không có quyền tạo mục kiến thức.') }))
    await click(byText(refused.page.root, 'button', 'Nhập từ Excel'))
    await settle()
    await click(byText(refused.page.root, 'button', 'Tải file mẫu (.xlsx)'))
    await settle()
    assert.equal(refused.lastToast('error'), 'Bạn không có quyền tạo mục kiến thức.')
    assert.equal(refused.downloads.length, 0)
  })

  it('import: FormData (file, publish, topic) POSTed; the per-row report shows; page 1 reloads; a refusal its sentence', async () => {
    const opened = await mountAdminPage(KNOWLEDGE, kbServer())
    await fire(pager(opened), 'update:page', 2)
    await settle()
    await click(byText(opened.page.root, 'button', 'Nhập từ Excel'))
    await settle()
    const file = new File([new Uint8Array([1, 2, 3])], 'hoi-dap.xlsx')
    await fire(findAll(opened.page.root, el => el.tag === 'input' && el.props.type === 'file')[0]!, 'change', { target: { files: [file] } })
    await input(findAll(opened.page.root, el => el.tag === 'input' && el.props.placeholder === 'general')[0]!, ' phap-luat ')
    await settle()
    const before = opened.calls.length
    await click(button(opened.page.root, 'Nhập'))
    await settle()
    const [post, reload] = opened.calls.slice(before)
    assert.equal(wire(post!), `POST ${KB_URL}/import`)
    const form = post!.body as FormData
    assert.ok(form instanceof FormData)
    assert.equal((form.get('file') as File).name, 'hoi-dap.xlsx')
    assert.equal(form.get('publish'), '0')
    assert.equal(form.get('topic'), 'phap-luat')
    assert.deepEqual(listQuery(reload!), { page: '1', ...EMPTY_FILTERS })
    assert.equal(opened.lastToast('warning'), 'Đã nhập 2/3 mục.')
    const report = findAll(opened.page.root, el => el.props['aria-label'] === 'Kết quả nhập tệp')[0]!
    assert.match(textOf(report), /Đã nhập 2\/3 mục, chưa nhập 1\./)
    assert.match(textOf(report), /Dòng 4–5\s*Đọc tệp\s*Thiếu câu trả lời\./)

    const refused = await mountAdminPage(KNOWLEDGE, kbServer({ [`POST ${KB_URL}/import`]: () => h3Error(413, 'Tệp vượt quá giới hạn 8 MB.') }))
    await click(byText(refused.page.root, 'button', 'Nhập từ Excel'))
    await settle()
    await fire(findAll(refused.page.root, el => el.tag === 'input' && el.props.type === 'file')[0]!, 'change', { target: { files: [file] } })
    await settle()
    await click(button(refused.page.root, 'Nhập'))
    await settle()
    assert.equal(refused.lastToast('error'), 'Tệp vượt quá giới hạn 8 MB.')
    assertOnlyServerSentences(refused)
  })

  it('the small-talk tab mounts the panel instead (deep link `?tab=small-talk`)', async () => {
    const opened = await mountAdminPage(KNOWLEDGE, kbServer(), { route: { query: { tab: 'small-talk' } } })
    assert.equal(findAll(opened.page.root, el => el.tag === 'AdminChatbotSmallTalkPanel').length, 1)
    await click(byText(opened.page.root, 'button', 'Kho nghiệp vụ'))
    assert.deepEqual(opened.pushes, [{ query: {} }])
  })
})

// ─── components/admin/ChatbotSmallTalkPanel.vue ──────────────────────────────

const PANEL = 'components/admin/ChatbotSmallTalkPanel.vue'
const ST_URL = '/api/admin/chatbot/small-talk'

const stRow = (id: number, over: Record<string, unknown> = {}) => ({
  id, category: 'social', question: `Xin chào ${id}`, answer: `Chào bạn ${id}`, patterns: ['xin chao'], isEnabled: true, isSystem: false,
  displayOrder: 0, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: null, ...over,
})
const stList = (items: unknown[], page = 1, totalPages = 1) => json({ ok: true, items, pagination: { page, perPage: 15, total: items.length, totalPages } })
const ST_ROWS = [stRow(1), stRow(2, { isEnabled: false, isSystem: true, patterns: [] })]
const ST_EMPTY_FILTERS = { perPage: '15', search: '', category: '', enabled: '' }

function stServer(overrides: Record<string, Route> = {}) {
  return routes({
    [`GET ${ST_URL}`]: () => stList(ST_ROWS, 1, 4),
    [`PATCH ${ST_URL}/1/toggle`]: () => json({ ok: true, item: stRow(1, { isEnabled: false }) }),
    [`DELETE ${ST_URL}/1`]: () => json({ ok: true }),
    [`POST ${ST_URL}`]: () => json({ ok: true, item: stRow(9) }),
    [`PUT ${ST_URL}/1`]: () => json({ ok: true, item: stRow(1) }),
    ...overrides,
  })
}
const dialog = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.props.role === 'dialog')[0]!
const dialogField = (opened: MountedAdminPage, tag: string, index = 0) => findAll(dialog(opened), el => el.tag === tag)[index]!

describe('components/admin/ChatbotSmallTalkPanel.vue', () => {
  it('mount: page 1 with every filter sent empty; a system row has no checkbox and no "Xóa"', async () => {
    const opened = await mountAdminPage(PANEL, stServer())
    assert.deepEqual(opened.calls.map(wire), [`GET ${ST_URL}?page=1&perPage=15&search&category&enabled`])
    const checkboxes = (row: MiniElement) => findAll(row, el => el.tag === 'input' && el.props.type === 'checkbox').length
    assert.equal(checkboxes(rowOf(opened, 'Xin chào 1')), 1)
    const system = rowOf(opened, 'Xin chào 2')
    assert.deepEqual(findAll(system, el => el.tag === 'td').map(textOf).slice(1, 6), ['Xã giao', 'Xin chào 2Hệ thống', 'Chào bạn 2', '0', '○Đã tắt'])
    assert.equal(checkboxes(system), 0)
    assert.equal(buttons(system, 'Xóa').length, 0)
  })

  it('a reload narrows the bulk selection to the rows on screen (keepOnly, run)', async () => {
    const opened = await mountAdminPage(PANEL, stServer({
      [`GET ${ST_URL}`]: call => (call.url.searchParams.get('page') === '2' ? stList([stRow(7)], 2, 4) : stList(ST_ROWS, 1, 4)),
    }))
    await fire(findAll(rowOf(opened, 'Xin chào 1'), el => el.tag === 'input' && el.props.type === 'checkbox')[0]!, 'change')
    await settle()
    assert.equal(findAll(opened.page.root, el => el.tag === 'AdminBulkActionBar')[0]?.props.count, 1)
    await fire(pager(opened), 'update:page', 2)
    await settle()
    assert.equal(findAll(opened.page.root, el => el.tag === 'AdminBulkActionBar').length, 0, 'row 1 is still selected on page 2')
  })

  it('filters and pages: each select reloads page 1; the pager and "Lọc" ask for their page', async () => {
    const opened = await mountAdminPage(PANEL, stServer())
    const before = opened.calls.length
    await input(selects(opened)[0]!, 'support')
    await settle()
    await input(selects(opened)[1]!, 'false')
    await settle()
    await fire(pager(opened), 'update:page', 4)
    await settle()
    await input(findAll(opened.page.root, el => el.tag === 'input' && el.props.type === 'search')[0]!, 'chào')
    await click(byText(opened.page.root, 'button', 'Lọc'))
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(listQuery), [
      { page: '1', ...ST_EMPTY_FILTERS, category: 'support' },
      { page: '1', ...ST_EMPTY_FILTERS, category: 'support', enabled: 'false' },
      { page: '4', ...ST_EMPTY_FILTERS, category: 'support', enabled: 'false' },
      { page: '1', ...ST_EMPTY_FILTERS, category: 'support', enabled: 'false', search: 'chào' },
    ])
  })

  it('FINDING: two select changes in flight — only the newer answer is shown', async () => {
    const pending: NetCall[] = []
    const opened = await mountAdminPage(PANEL, routes({
      [`GET ${ST_URL}`]: call => { if (!call.url.searchParams.get('category')) return stList(ST_ROWS); pending.push(call); return undefined },
    }))
    await input(selects(opened)[0]!, 'support')
    await settle()
    await input(selects(opened)[0]!, 'navigation')
    await settle()
    pending[1]!.respond(stList([stRow(7, { question: 'Đường tới trụ sở' })]))
    await settle()
    pending[0]!.respond(stList([stRow(5, { question: 'Tôi buồn quá' })]))
    await settle()
    assert.match(screen(opened), /Đường tới trụ sở/)
    assert.doesNotMatch(screen(opened), /Tôi buồn quá/, 'the "support" answer is shown under the "navigation" filter')
  })

  it('FINDING: a superseded request\'s failure does not replace the newer rows with an error; nor does its loading end', async () => {
    const pending: NetCall[] = []
    const opened = await mountAdminPage(PANEL, routes({
      [`GET ${ST_URL}`]: call => { if (!call.url.searchParams.get('category')) return stList(ST_ROWS); pending.push(call); return undefined },
    }))
    await input(selects(opened)[0]!, 'support')
    await settle()
    await input(selects(opened)[0]!, 'navigation')
    await settle()
    // 403, not 5xx: ofetch retries a GET once on 5xx, which would keep this request in flight.
    pending[0]!.respond(h3Error(403, 'Bạn không có quyền lọc nhóm này.'))
    await settle()
    assert.equal(findAll(opened.page.root, el => el.tag === 'SkeletonTable').length, 1, 'the newer request is still loading')
    assert.equal(alertText(opened.page), '')
    pending[1]!.respond(stList([stRow(7, { question: 'Đường tới trụ sở' })]))
    await settle()
    assert.equal(alertText(opened.page), '')
    assert.match(screen(opened), /Đường tới trụ sở/)
  })

  it('toggle / delete: the request, the toast, a reload of the current page', async () => {
    const opened = await mountAdminPage(PANEL, stServer())
    await fire(pager(opened), 'update:page', 3)
    await settle()
    let before = opened.calls.length
    await click(buttons(rowOf(opened, 'Xin chào 1'), 'Tắt')[0]!)
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire), [`PATCH ${ST_URL}/1/toggle`, `GET ${ST_URL}?page=3&perPage=15&search&category&enabled`])
    assert.equal(opened.lastToast('success'), 'Đã tắt mục.')
    before = opened.calls.length
    await click(buttons(rowOf(opened, 'Xin chào 1'), 'Xóa')[0]!)
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire), [`DELETE ${ST_URL}/1`, `GET ${ST_URL}?page=3&perPage=15&search&category&enabled`])
    assert.equal(opened.confirms.at(-1)?.title, 'Xóa mục trả lời')
    assert.equal(opened.lastToast('success'), 'Đã xóa mục.')

    const refused = await mountAdminPage(PANEL, stServer({ [`PATCH ${ST_URL}/1/toggle`]: () => dropped(), [`DELETE ${ST_URL}/1`]: () => h3Error(400, 'Không xóa được mục hệ thống.') }))
    await click(buttons(rowOf(refused, 'Xin chào 1'), 'Tắt')[0]!)
    await settle()
    assert.equal(refused.lastToast('error'), 'Không thể đổi trạng thái mục.')
    await click(buttons(rowOf(refused, 'Xin chào 1'), 'Xóa')[0]!)
    await settle()
    assert.equal(refused.lastToast('error'), 'Không xóa được mục hệ thống.')
    assertOnlyServerSentences(refused)
  })

  it('create: POSTs the form (patterns one per line, trimmed), toasts, closes, reloads page 1', async () => {
    const opened = await mountAdminPage(PANEL, stServer())
    await fire(pager(opened), 'update:page', 2)
    await settle()
    await click(byText(opened.page.root, 'button', 'Thêm mục mới'))
    await settle()
    await input(dialogField(opened, 'input'), ' Cảm ơn ')
    await input(dialogField(opened, 'textarea', 0), ' Không có gì. ')
    await input(dialogField(opened, 'textarea', 1), 'cam on\n\n  thank you  ')
    await settle()
    const before = opened.calls.length
    await click(byText(dialog(opened), 'button', 'Lưu'))
    await settle()
    assert.deepEqual(sent(opened.calls, before), [
      { wire: `POST ${ST_URL}`, body: { category: 'social', question: 'Cảm ơn', answer: 'Không có gì.', patterns: ['cam on', 'thank you'] } },
      `GET ${ST_URL}?page=1&perPage=15&search&category&enabled`,
    ])
    assert.equal(opened.lastToast('success'), 'Đã thêm mục mới.')
    assert.equal(findAll(opened.page.root, el => el.props.role === 'dialog').length, 0)
  })

  it('FINDING: saving an edit on page 3 reloads page 3, not page 1', async () => {
    const opened = await mountAdminPage(PANEL, stServer())
    await fire(pager(opened), 'update:page', 3)
    await settle()
    await click(buttons(rowOf(opened, 'Xin chào 1'), 'Sửa')[0]!)
    await settle()
    const before = opened.calls.length
    await click(byText(dialog(opened), 'button', 'Lưu'))
    await settle()
    assert.deepEqual(sent(opened.calls, before), [
      { wire: `PUT ${ST_URL}/1`, body: { category: 'social', question: 'Xin chào 1', answer: 'Chào bạn 1', patterns: ['xin chao'] } },
      `GET ${ST_URL}?page=3&perPage=15&search&category&enabled`,
    ])
    assert.equal(opened.lastToast('success'), 'Đã cập nhật mục.')
  })

  it('save refused: the server\'s sentence inside the dialog, which stays open', async () => {
    const opened = await mountAdminPage(PANEL, stServer({ [`POST ${ST_URL}`]: () => h3Error(400, 'Câu hỏi chuẩn không được để trống.') }))
    await click(byText(opened.page.root, 'button', 'Thêm mục mới'))
    await settle()
    await click(byText(dialog(opened), 'button', 'Lưu'))
    await settle()
    assert.match(textOf(findAll(dialog(opened), el => el.props.role === 'alert')[0]!), /Câu hỏi chuẩn không được để trống\./)
    assert.equal(opened.toasts.length, 0)
    assertOnlyServerSentences(opened)
  })

  it('load failure: the server\'s sentence + "Thử lại" (current page); FINDING: no empty state under the alert', async () => {
    let answer: () => Response | Error = () => h3Error(403, 'Bạn không có quyền xem kho trả lời.')
    const opened = await mountAdminPage(PANEL, routes({ [`GET ${ST_URL}`]: () => answer() }))
    assert.match(alertText(opened.page), /Bạn không có quyền xem kho trả lời\./)
    assert.doesNotMatch(screen(opened), /Chưa có mục trả lời nào|Không có kết quả phù hợp/, 'a list that was never read is not "empty"')
    answer = () => stList(ST_ROWS)
    const before = opened.calls.length
    await click(byText(opened.page.root, 'button', 'Thử lại'))
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(listQuery), [{ page: '1', ...ST_EMPTY_FILTERS }])
    assert.equal(alertText(opened.page), '')

    const offline = await mountAdminPage(PANEL, routes({ [`GET ${ST_URL}`]: () => dropped() }))
    assert.match(alertText(offline.page), /Không thể tải kho trả lời thường nhật\./)
    assertOnlyServerSentences(offline)
    const empty = await mountAdminPage(PANEL, routes({ [`GET ${ST_URL}`]: () => stList([]) }))
    assert.match(screen(empty), /Chưa có mục trả lời nào\./)
  })
})
