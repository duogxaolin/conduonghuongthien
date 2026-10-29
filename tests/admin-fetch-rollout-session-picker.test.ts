/**
 * Wave 3 D-FETCH, batch F: `pages/admin/chatbot/sessions/[id].vue` (1 `$fetch` cast — its three
 * hand-written interfaces now derived, `AdminChatSessionResponse` in app/types/admin-chatbot-api.ts)
 * and `components/admin/ContentTypePicker.vue` (2 — the menu editors' picker, reading the PUBLIC
 * lists; `PickerContentTypesResponse`/`PickerCategoriesResponse` in app/types/admin-taxonomy-api.ts).
 *
 * The REAL components over REAL ofetch on a fake network; green before and after the conversion
 * (no FINDING fixed here — the picker's cached failure is recorded, not fixed: KNOWN below).
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { fire, findAll, textOf } from './_sfc-mount.ts'
import { alertText, h3Error, json, mountAdminPage, OFETCH_LINE, OpenModal, routes, settle, unmountAll, wire } from './_admin-page-harness.ts'

afterEach(unmountAll)

// ─── pages/admin/chatbot/sessions/[id].vue ──────────────────────────────────

const SESSION = '/api/admin/chatbot/sessions/abc'
const STAMP = '2026-10-20T02:00:00.000Z'
const SESSION_ANSWER = {
  ok: true,
  session: { id: 'abc', ip: '10.0.0.1', userAgent: 'UA', browser: 'Chrome trên Android', detectedPhone: '0900000001', detectedName: 'Nguyễn A', messageCount: 2, startedAt: STAMP, lastMessageAt: STAMP },
  messages: [
    { id: 1, role: 'user', content: 'Tôi cần hỗ trợ việc làm', kind: null, createdAt: STAMP },
    { id: 2, role: 'assistant', content: 'Bạn có thể đăng ký tại đây.', kind: 'knowledge', createdAt: STAMP },
  ],
  truncated: false,
  relatedSubmissions: [{ id: 12, fullName: 'Nguyễn A', phone: '0900000001', email: null, formTitle: 'Đăng ký hỗ trợ', createdAt: STAMP }],
}
const openSession = (route: () => Response | Error) =>
  mountAdminPage('pages/admin/chatbot/sessions/[id].vue', routes({ [`GET ${SESSION}`]: route }), { route: { params: { id: 'abc' } } })

describe('pages/admin/chatbot/sessions/[id].vue', () => {
  it('reads the session once; the device, the transcript and the forms filed from it render', async () => {
    const opened = await openSession(() => json(SESSION_ANSWER))
    assert.deepEqual(opened.calls.map(wire), [`GET ${SESSION}`])
    const screen = textOf(opened.page.root)
    assert.match(screen, /Chrome trên Android/)
    assert.match(screen, /Tôi cần hỗ trợ việc làm/)
    assert.match(screen, /Bạn có thể đăng ký tại đây\./)
    assert.match(screen, /Đăng ký hỗ trợ/)
    assert.equal(alertText(opened.page), '')
  })

  it('a failed read: the server\'s sentence in role="alert" with "Thử lại", which asks again', async () => {
    const opened = await openSession(() => h3Error(404, 'Không tìm thấy phiên trò chuyện.'))
    assert.match(alertText(opened.page), /Không tìm thấy phiên trò chuyện\./)
    assert.doesNotMatch(alertText(opened.page), OFETCH_LINE)
    await fire(findAll(opened.page.root, el => el.tag === 'button' && textOf(el) === 'Thử lại')[0]!, 'click')
    await settle()
    assert.deepEqual(opened.calls.map(wire), [`GET ${SESSION}`, `GET ${SESSION}`])
  })
})

// ─── components/admin/ContentTypePicker.vue ─────────────────────────────────

const TYPES = [{ slug: 'news', name: 'Bản tin', icon: 'fa-solid fa-newspaper', description: null }]
const CATEGORIES = [
  { id: 1, name: 'Tin nổi bật', slug: 'featured-news', parentId: null },
  { id: 2, name: 'Con của nổi bật', slug: 'sub', parentId: 1 },
]
function openPicker(categories: () => Response | Error = () => json({ ok: true, items: CATEGORIES }), types: () => Response | Error = () => json({ ok: true, items: TYPES })) {
  const picked: unknown[] = []
  return mountAdminPage('components/admin/ContentTypePicker.vue', routes({
    'GET /api/public/content-types': types,
    'GET /api/public/categories': categories,
  }), {
    modules: { '~/components/admin/AdminModal.vue': { default: OpenModal } },
    props: { onPick: (value: unknown) => picked.push(['pick', value]), onPickChild: (value: unknown) => picked.push(['child', value]) },
  }).then(opened => Object.assign(opened, { picked }))
}
const expandButton = (opened: Awaited<ReturnType<typeof openPicker>>) =>
  findAll(opened.page.root, el => el.tag === 'button' && el.props['aria-expanded'] !== undefined)[0]!

describe('components/admin/ContentTypePicker.vue', () => {
  it('lists the public content types; picking one emits its URL', async () => {
    const opened = await openPicker()
    assert.deepEqual(opened.calls.map(wire), ['GET /api/public/content-types'])
    await fire(findAll(opened.page.root, el => el.tag === 'button' && textOf(el).startsWith('Bản tin'))[0]!, 'click')
    assert.deepEqual(opened.picked[0], ['pick', { slug: 'news', name: 'Bản tin', url: '/news', icon: 'fa-solid fa-newspaper' }])
  })

  it('expanding a type asks for its categories once and lists only the top-level ones', async () => {
    const opened = await openPicker()
    await fire(expandButton(opened), 'click')
    await settle()
    assert.deepEqual(opened.calls.slice(1).map(wire), ['GET /api/public/categories?type=news'])
    const screen = textOf(opened.page.root)
    assert.match(screen, /Tin nổi bật/)
    assert.doesNotMatch(screen, /Con của nổi bật/)
    await fire(expandButton(opened), 'click')
    await fire(expandButton(opened), 'click')
    await settle()
    assert.equal(opened.calls.length, 2, 'cached')
  })

  it('a failed type list: the alert with the page\'s sentence; `ok: false` the same', async () => {
    const refused = await openPicker(undefined, () => h3Error(503, 'Bảo trì.'))
    assert.match(alertText(refused.page), /Không tải được danh sách thể loại\./)
    const notOk = await openPicker(undefined, () => json({ ok: false, items: [] }))
    assert.match(alertText(notOk.page), /Không tải được danh sách thể loại\./)
  })

  it('KNOWN (not fixed in batch F): a failed category read reads "no sub-categories" and is cached until the dialog reopens', async () => {
    const opened = await openPicker(() => h3Error(403, 'Lỗi.'))
    await fire(expandButton(opened), 'click')
    await settle()
    assert.match(textOf(opened.page.root), /Thể loại này chưa có danh mục con\./)
    await fire(expandButton(opened), 'click')
    await fire(expandButton(opened), 'click')
    await settle()
    assert.equal(opened.calls.length, 2)
  })
})
