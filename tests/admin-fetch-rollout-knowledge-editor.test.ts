/**
 * Wave 3 D-FETCH, batch E: one chatbot knowledge entry — `pages/admin/chatbot/knowledge/[id].vue`
 * (3 `$fetch` casts) — calls `adminFetch<T>()` with response types derived from the handlers
 * (`AdminKnowledgeDetail` in app/types/admin-api.ts; create/update/transition in
 * app/types/admin-chatbot-api.ts).
 *
 * The REAL page is mounted (tests/_admin-page-harness.ts) over REAL ofetch on a fake network.
 * Pinned, green before and after the conversion:
 *   - an existing entry is read once and fills the form; a new one asks for nothing;
 *   - saving PUTs (or POSTs, for a new entry) the content payload — never `status` — then
 *     reloads (or opens the new entry); publish/archive ask first, POST their own route, reload;
 *   - every failure shows the sentence the SERVER wrote, never ofetch's `[GET] "…"` line.
 *
 * FINDINGS, RED on the base (88073004):
 *   - "Xuất bản"/"Lưu trữ" over a dropped connection said "Đã xảy ra lỗi." — the
 *     `errorMessage(err, 'Đã xảy ra lỗi.') || (…)` branch with the action's own sentence was
 *     dead (`errorMessage` never returns ''), the batch-C finding of the list page, here too;
 *   - a failed SAVE (or publish, or the "required" check) shared the load's alert and its
 *     "thử lại" — which RELOADS the entry, replacing what the officer typed with the stored
 *     row. Only a failed load offers "thử lại" now; an action's failure is just its sentence;
 *   - a failed LOAD still rendered the form: empty fields, "Lưu nội dung" enabled and
 *     "Xuất bản" offered from the default `draft` — typing an answer and saving PUT that form
 *     over the real entry (its aliases, keywords and sources emptied). The form is shown only
 *     once it holds the entry (`loaded`, the positive flag of the batch-D article editor).
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { byText, click, findAll, fire, input, textOf } from './_sfc-mount.ts'
import {
  alerts, alertText, dropped, h3Error, json, mountAdminPage, OFETCH_LINE, routes, sent, settle, unmountAll, wire,
  type MountedAdminPage, type NetCall, type Responder,
} from './_admin-page-harness.ts'

afterEach(unmountAll)

type Route = (call: NetCall) => Response | Error | undefined

const PAGE = 'pages/admin/chatbot/knowledge/[id].vue'
const URL7 = '/api/admin/chatbot/knowledge/7'
const entry = (over: Record<string, unknown> = {}) => ({
  id: 7, canonicalQuestion: 'Thủ tục xin xác nhận cư trú?', approvedAnswer: 'Đến công an xã nơi cư trú.', topic: 'cu-tru',
  aliases: ['xác nhận cư trú', 'giấy cư trú'], keywords: ['cư trú'], sourceLabel: 'Luật Cư trú 2020', sourceUrl: 'https://example.vn/luat',
  sourceReference: 'Điều 19', internalNotes: 'Đã đối chiếu.', priority: 3, isQuickQuestion: true, status: 'published', ...over,
})
const answer = (over: Record<string, unknown> = {}) => json({ ok: true, item: entry(over) })

function server(overrides: Record<string, Route> = {}): Responder {
  return routes({
    [`GET ${URL7}`]: () => answer(),
    [`PUT ${URL7}`]: call => json({ ok: true, item: entry(call.body as Record<string, unknown>) }),
    'POST /api/admin/chatbot/knowledge': call => json({ ok: true, item: entry({ ...(call.body as object), id: 31, status: 'draft' }) }),
    [`POST ${URL7}/publish`]: () => answer({ status: 'published' }),
    [`POST ${URL7}/archive`]: () => answer({ status: 'archived' }),
    ...overrides,
  })
}

const errorStandIn = (input: { statusCode?: number, statusMessage?: string }) => Object.assign(new Error(input.statusMessage), input)
async function open(responder = server(), id = '7') {
  const navigations: unknown[] = []
  const opened = await mountAdminPage(PAGE, responder, {
    route: { params: { id } },
    auto: { navigateTo: (to: unknown) => { navigations.push(to) }, createError: errorStandIn },
  })
  return Object.assign(opened, { navigations })
}
const screen = (opened: MountedAdminPage) => textOf(opened.page.root)
/** The control inside the `<label>` whose text starts with `label`. */
const field = (opened: MountedAdminPage, label: string) => {
  const owner = findAll(opened.page.root, el => el.tag === 'label' && textOf(el).startsWith(label))[0]
  assert.ok(owner, `no "${label}" field`)
  return findAll(owner, el => el.tag === 'input' || el.tag === 'textarea')[0]!
}
const button = (opened: MountedAdminPage, label: string) => findAll(opened.page.root, el => el.tag === 'button' && textOf(el) === label)[0]
const form = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'form')[0]
async function submit(opened: MountedAdminPage) {
  await fire(form(opened)!, 'submit')
  await settle()
}
/** A "thử lại" inside an alert, i.e. the reload offered with the message. */
const reloadOffered = (opened: MountedAdminPage) => alerts(opened.page).some(el => findAll(el, b => b.tag === 'button' && textOf(b) === 'thử lại').length > 0)

describe(PAGE, () => {
  it('an existing entry is read once and fills the form; its status decides which lifecycle button shows', async () => {
    const opened = await open()
    assert.deepEqual(opened.calls.map(wire), [`GET ${URL7}`])
    assert.equal(field(opened, 'Câu hỏi chính').model?.value, 'Thủ tục xin xác nhận cư trú?')
    assert.equal(field(opened, 'Bí danh').model?.value, 'xác nhận cư trú\ngiấy cư trú')
    assert.equal(field(opened, 'Độ ưu tiên').model?.value, 3)
    assert.match(screen(opened), /Đã xuất bản/)
    assert.ok(button(opened, 'Lưu trữ'))
    assert.ok(!button(opened, 'Xuất bản'))
    assert.equal(alertText(opened.page), '')
  })

  it('save: PUT the content payload (never `status`), toast, then read the entry again', async () => {
    const opened = await open()
    await input(field(opened, 'Câu hỏi chính'), 'Xin xác nhận cư trú ở đâu?')
    await input(field(opened, 'Từ khóa'), 'cư trú, xác nhận\n tạm trú ')
    const before = opened.calls.length
    await submit(opened)
    assert.deepEqual(sent(opened.calls, before), [
      {
        wire: `PUT ${URL7}`,
        body: {
          canonicalQuestion: 'Xin xác nhận cư trú ở đâu?', approvedAnswer: 'Đến công an xã nơi cư trú.', topic: 'cu-tru',
          aliases: ['xác nhận cư trú', 'giấy cư trú'], keywords: ['cư trú', 'xác nhận', 'tạm trú'], sourceLabel: 'Luật Cư trú 2020',
          sourceUrl: 'https://example.vn/luat', sourceReference: 'Điều 19', internalNotes: 'Đã đối chiếu.', priority: 3, isQuickQuestion: true,
        },
      },
      `GET ${URL7}`,
    ])
    assert.equal(opened.lastToast('success'), 'Đã cập nhật nội dung kiến thức.')
  })

  it('a new entry asks for nothing on mount; save POSTs it and opens the created entry', async () => {
    const opened = await open(server(), 'new')
    assert.deepEqual(opened.calls.map(wire), [])
    assert.match(screen(opened), /Tạo mục kiến thức/)
    assert.ok(!button(opened, 'Xuất bản'))
    await input(field(opened, 'Câu hỏi chính'), 'Hỏi mới')
    await input(field(opened, 'Câu trả lời đã duyệt'), 'Đáp mới')
    await submit(opened)
    assert.deepEqual(opened.calls.map(wire), ['POST /api/admin/chatbot/knowledge'])
    assert.equal((opened.calls[0]!.body as Record<string, unknown>).canonicalQuestion, 'Hỏi mới')
    assert.ok(!('status' in (opened.calls[0]!.body as object)))
    assert.equal(opened.lastToast('success'), 'Đã tạo bản nháp kiến thức.')
    assert.deepEqual(opened.navigations, ['/admin/chatbot/knowledge/31'])
  })

  it('an empty answer is refused on the page, without a request', async () => {
    const opened = await open()
    await input(field(opened, 'Câu trả lời đã duyệt'), '   ')
    const before = opened.calls.length
    await submit(opened)
    assert.equal(opened.calls.length, before)
    assert.match(alertText(opened.page), /Câu hỏi và câu trả lời là bắt buộc\./)
  })

  it('publish asks first and POSTs its own route, then reloads; declining sends nothing', async () => {
    const opened = await open(server({ [`GET ${URL7}`]: () => answer({ status: 'draft' }) }))
    opened.answers.confirm = false
    await click(button(opened, 'Xuất bản')!)
    await settle()
    assert.equal(opened.calls.length, 1)
    assert.match(opened.confirms[0]!.message!, /Xuất bản nội dung đã lưu\?/)
    opened.answers.confirm = true
    const before = opened.calls.length
    await click(button(opened, 'Xuất bản')!)
    await settle()
    assert.deepEqual(sent(opened.calls, before), [`POST ${URL7}/publish`, `GET ${URL7}`])
    assert.equal(opened.lastToast('success'), 'Đã xuất bản mục kiến thức.')
  })

  it('a failed load shows the server\'s sentence and "thử lại", which reads the entry again', async () => {
    let fail = true
    const opened = await open(server({ [`GET ${URL7}`]: () => (fail ? h3Error(404, 'Knowledge entry not found') : answer()) }))
    assert.match(alertText(opened.page), /^Knowledge entry not found Vui lòng thử lại\.$/)
    fail = false
    await click(byText(opened.page.root, 'button', 'thử lại'))
    await settle()
    assert.deepEqual(opened.calls.map(wire), [`GET ${URL7}`, `GET ${URL7}`])
    assert.equal(alertText(opened.page), '')
    assert.equal(field(opened, 'Câu hỏi chính').model?.value, 'Thủ tục xin xác nhận cư trú?')
  })

  it('a refused save shows the server\'s sentence, not ofetch\'s line, and keeps the typed text', async () => {
    const opened = await open(server({ [`PUT ${URL7}`]: () => h3Error(400, 'URL nguồn phải bắt đầu bằng https://') }))
    await input(field(opened, 'URL nguồn'), 'ftp://x')
    await submit(opened)
    assert.match(alertText(opened.page), /URL nguồn phải bắt đầu bằng https:\/\//)
    assert.doesNotMatch(alertText(opened.page), OFETCH_LINE)
    assert.equal(field(opened, 'URL nguồn').model?.value, 'ftp://x')
  })

  it('FINDING: publish over a dropped connection says it could not publish, not "Đã xảy ra lỗi." (RED on base)', async () => {
    const opened = await open(server({ [`GET ${URL7}`]: () => answer({ status: 'draft' }), [`POST ${URL7}/publish`]: () => dropped() }))
    await click(button(opened, 'Xuất bản')!)
    await settle()
    assert.match(alertText(opened.page), /Không thể xuất bản mục kiến thức\./)
    assert.doesNotMatch(alertText(opened.page), /Đã xảy ra lỗi\.|fetch failed/)
  })

  it('FINDING: archive over a dropped connection says it could not archive (RED on base)', async () => {
    const opened = await open(server({ [`POST ${URL7}/archive`]: () => dropped() }))
    await click(button(opened, 'Lưu trữ')!)
    await settle()
    assert.match(alertText(opened.page), /Không thể lưu trữ mục kiến thức\./)
  })

  it('FINDING: a failed save offers no "thử lại" that would reload the entry over the officer\'s edits (RED on base)', async () => {
    const opened = await open(server({ [`PUT ${URL7}`]: () => h3Error(400, 'URL nguồn phải bắt đầu bằng https://') }))
    await input(field(opened, 'Câu trả lời đã duyệt'), 'Câu trả lời đã sửa, chưa lưu.')
    await submit(opened)
    assert.ok(!reloadOffered(opened), 'the save failure offers "thử lại", which reloads the stored entry')
    assert.equal(field(opened, 'Câu trả lời đã duyệt').model?.value, 'Câu trả lời đã sửa, chưa lưu.')
  })

  it('FINDING: neither the "required" refusal nor a failed publish offers that reload (RED on base)', async () => {
    const opened = await open(server({ [`GET ${URL7}`]: () => answer({ status: 'draft' }), [`POST ${URL7}/publish`]: () => h3Error(400, 'Thiếu nguồn tham khảo.') }))
    await input(field(opened, 'Câu hỏi chính'), '')
    await submit(opened)
    assert.match(alertText(opened.page), /bắt buộc/)
    assert.ok(!reloadOffered(opened), 'the "required" refusal offers "thử lại"')
    await input(field(opened, 'Câu hỏi chính'), 'Câu hỏi đang gõ')
    await click(button(opened, 'Xuất bản')!)
    await settle()
    assert.match(alertText(opened.page), /Thiếu nguồn tham khảo\./)
    assert.ok(!reloadOffered(opened), 'the publish failure offers "thử lại"')
    assert.equal(field(opened, 'Câu hỏi chính').model?.value, 'Câu hỏi đang gõ')
  })

  it('verify E: saved, then the re-read fails — the form stays with the saved text, and "thử lại" keeps what is typed since', async () => {
    let gets = 0
    let failReads = false
    const opened = await open(server({ [`GET ${URL7}`]: () => (++gets > 1 && failReads ? h3Error(503, 'Máy chủ bận.') : answer()) }))
    failReads = true
    await input(field(opened, 'Câu hỏi chính'), 'Câu hỏi đã sửa')
    await submit(opened)
    assert.equal(opened.lastToast('success'), 'Đã cập nhật nội dung kiến thức.')
    assert.ok(form(opened), 'the form vanished after a successful save whose re-read failed')
    assert.equal(field(opened, 'Câu hỏi chính').model?.value, 'Câu hỏi đã sửa')
    assert.match(alertText(opened.page), /Máy chủ bận\. Vui lòng thử lại\./)
    await input(field(opened, 'Câu trả lời đã duyệt'), 'Đang gõ tiếp, chưa lưu.')
    failReads = false
    await click(byText(opened.page.root, 'button', 'thử lại'))
    await settle()
    assert.equal(alertText(opened.page), '')
    assert.equal(field(opened, 'Câu trả lời đã duyệt').model?.value, 'Đang gõ tiếp, chưa lưu.', '"thử lại" replaced the text being typed')
    assert.equal(field(opened, 'Câu hỏi chính').model?.value, 'Câu hỏi đã sửa')
  })

  it('verify E: published, then the re-read fails — the form stays and the badge says what the publish answered', async () => {
    let gets = 0
    const opened = await open(server({
      [`GET ${URL7}`]: () => (++gets === 1 ? answer({ status: 'draft' }) : h3Error(503, 'Máy chủ bận.')),
    }))
    await click(button(opened, 'Xuất bản')!)
    await settle()
    assert.equal(opened.lastToast('success'), 'Đã xuất bản mục kiến thức.')
    assert.ok(form(opened), 'the form vanished after a successful publish whose re-read failed')
    assert.match(screen(opened), /Đã xuất bản/)
    assert.ok(!button(opened, 'Xuất bản'), '"Xuất bản" is still offered for an entry the server just published')
  })

  it('verify E: a failed save\'s sentence goes away when the next save succeeds', async () => {
    let refuse = true
    const opened = await open(server({ [`PUT ${URL7}`]: call => (refuse ? h3Error(400, 'URL nguồn phải bắt đầu bằng https://') : json({ ok: true, item: entry(call.body as Record<string, unknown>) })) }))
    await submit(opened)
    assert.match(alertText(opened.page), /URL nguồn/)
    refuse = false
    await submit(opened)
    assert.equal(alertText(opened.page), '', 'the earlier failure is still shown over a successful save')
  })

  it('verify E: a failed publish\'s sentence goes away when the next publish succeeds', async () => {
    let refuse = true
    const opened = await open(server({
      [`GET ${URL7}`]: () => answer({ status: refuse ? 'draft' : 'published' }),
      [`POST ${URL7}/publish`]: () => (refuse ? h3Error(400, 'Thiếu nguồn tham khảo.') : answer({ status: 'published' })),
    }))
    await click(button(opened, 'Xuất bản')!)
    await settle()
    assert.match(alertText(opened.page), /Thiếu nguồn tham khảo\./)
    refuse = false
    await click(button(opened, 'Xuất bản')!)
    await settle()
    assert.equal(alertText(opened.page), '', 'the earlier failure is still shown over a successful publish')
  })

  it('FINDING: a failed load renders no empty form to save over the real entry (RED on base)', async () => {
    const opened = await open(server({ [`GET ${URL7}`]: () => h3Error(503, 'Cơ sở dữ liệu đang bảo trì.') }))
    assert.match(alertText(opened.page), /Cơ sở dữ liệu đang bảo trì\./)
    // Booleans, not `assert.equal(element, undefined)`: a failing assert inspects its operand,
    // and a mounted element reaches the whole Vue app.
    assert.ok(!form(opened), 'an empty form is offered for an entry that was not read')
    assert.ok(!button(opened, 'Lưu nội dung'))
    assert.ok(!button(opened, 'Xuất bản'), '"Xuất bản" is offered from the default status of an unread entry')
    assert.ok(!opened.calls.some(call => call.method !== 'GET'))
  })
})
