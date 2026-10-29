/**
 * Wave 3 D-FETCH, batch F: the two menu editors — `pages/admin/content/navigation/navbar.vue`
 * and `…/mobile.vue` (2 `$fetch` casts each) — call `adminFetch<T>()` with response types
 * from app/types/admin-navigation-api.ts.
 *
 * The REAL page — `<script setup>` and template — is mounted (tests/_admin-page-harness.ts)
 * over REAL ofetch on a fake network. Pinned, green before and after the conversion:
 *   - the GET of the mount and the exact PUT body of "Lưu cấu hình";
 *   - a stored menu is edited as stored; nothing stored (`menu: null`) edits the default,
 *     and saving it stores the default (a legitimate first save);
 *   - a failed load shows the sentence the SERVER wrote in a `role="alert"` with "thử lại",
 *     never ofetch's `[GET] "…"` line; a failed save toasts the server's sentence.
 *
 * FINDINGS, RED on the base (551651c7): "Lưu cấu hình" sits in the header, outside the
 * loading/error chain, and was disabled only while saving —
 *   - a FAILED load filled the editor's state with the default menu behind the alert, and
 *     "Lưu cấu hình" PUT that default over the site's real navigation;
 *   - while the first load was still in flight the state was `[]`, and "Lưu cấu hình" PUT
 *     an EMPTY menu (the navbar stores `[]`; the tab bar too).
 * Saving now needs a positive `loaded` flag — false from the start of every load, true only
 * once the answer filled the editor — enforced twice, each with its own test: the button is
 * disabled, and `saveMenu` returns without a request when a click reaches it anyway.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { fire, findAll, textOf, type MiniElement } from './_sfc-mount.ts'
import {
  alertText, dropped, h3Error, json, mountAdminPage, OFETCH_LINE, routes, sent, settle, Stub, unmountAll, wire,
  type MountedAdminPage, type NetCall, type Responder,
} from './_admin-page-harness.ts'

afterEach(unmountAll)

type Route = (call: NetCall) => Response | Error | undefined

interface Editor {
  page: string
  url: string
  stored: Array<Record<string, unknown>>
  /** First label of the page's DEFAULT_MENU — what a "nothing stored" load edits. */
  defaultFirst: string
  defaultCount: number
  loadFallback: string
  /** `placeholder` of a top-level row's label input. */
  labelPlaceholder: string
}

const EDITORS: Editor[] = [
  {
    page: 'pages/admin/content/navigation/navbar.vue',
    url: '/api/admin/settings/navigation/navbar',
    stored: [
      { id: 'a', label: 'Trang nhà', url: '/', openNewTab: false, children: [{ id: 'a1', label: 'Con', url: '/con', openNewTab: true }] },
      { id: 'b', label: 'Liên hệ riêng', url: '/contact', openNewTab: true },
    ],
    defaultFirst: 'Trang chủ',
    defaultCount: 8,
    loadFallback: 'Không tải được cấu hình menu navbar.',
    labelPlaceholder: 'Nhãn hiển thị',
  },
  {
    page: 'pages/admin/content/navigation/mobile.vue',
    url: '/api/admin/settings/navigation/mobile',
    stored: [
      { id: 'h', label: 'Nhà', icon: 'fa-solid fa-house', type: 'link', url: '/', featured: false },
      { id: 'c', label: 'Trợ lý', icon: 'fa-solid fa-comment', type: 'chatbot', url: '', featured: true },
    ],
    defaultFirst: 'Trang chủ',
    defaultCount: 5,
    loadFallback: 'Không tải được cấu hình thanh điều hướng.',
    labelPlaceholder: 'Nhãn (vd: Trang chủ)',
  },
]

const PICKER = { '~/components/admin/ContentTypePicker.vue': { default: Stub } }

function server(editor: Editor, overrides: Record<string, Route> = {}): Responder {
  return routes({
    [`GET ${editor.url}`]: () => json({ ok: true, menu: editor.stored }),
    [`PUT ${editor.url}`]: call => json({ ok: true, menu: (call.body as { menu: unknown }).menu }),
    ...overrides,
  })
}

const open = (editor: Editor, responder = server(editor)) => mountAdminPage(editor.page, responder, { modules: PICKER })
const saveButton = (opened: MountedAdminPage): MiniElement => {
  const found = findAll(opened.page.root, el => el.tag === 'button' && /Lưu cấu hình|Đang lưu/.test(textOf(el)))
  assert.equal(found.length, 1, 'one "Lưu cấu hình" button')
  return found[0]!
}
const disabled = (el: MiniElement) => el.props.disabled === true || el.props.disabled === ''
/** The label inputs of the top-level rows, in order. */
const labels = (opened: MountedAdminPage, editor: Editor) =>
  findAll(opened.page.root, el => el.tag === 'input' && el.props.placeholder === editor.labelPlaceholder).map(el => el.model?.value)
const puts = (opened: MountedAdminPage, from = 0) => opened.calls.slice(from).filter(call => call.method === 'PUT')

for (const editor of EDITORS) {
  describe(editor.page, () => {
    it('mount: one GET; the stored menu is what the editor holds; "Lưu cấu hình" PUTs it back unchanged', async () => {
      const opened = await open(editor)
      assert.deepEqual(opened.calls.map(wire), [`GET ${editor.url}`])
      assert.deepEqual(labels(opened, editor), editor.stored.map(item => item.label))
      assert.equal(disabled(saveButton(opened)), false)
      await fire(saveButton(opened), 'click')
      await settle()
      const [put] = puts(opened)
      assert.ok(put, 'a PUT')
      assert.equal(wire(put), `PUT ${editor.url}`)
      const body = put.body as { menu: Array<Record<string, unknown>> }
      assert.deepEqual(body.menu.map(item => item.label), editor.stored.map(item => item.label))
      assert.deepEqual(body.menu.map(item => item.id), editor.stored.map(item => item.id))
      assert.match(opened.lastToast('success') ?? '', /Đã lưu/)
    })

    it('nothing stored (`menu: null`) edits the default menu, and saving stores it — a legitimate first save', async () => {
      const opened = await open(editor, server(editor, { [`GET ${editor.url}`]: () => json({ ok: true, menu: null }) }))
      assert.equal(labels(opened, editor)[0], editor.defaultFirst)
      assert.equal(labels(opened, editor).length, editor.defaultCount)
      assert.equal(disabled(saveButton(opened)), false)
      await fire(saveButton(opened), 'click')
      await settle()
      assert.equal(puts(opened).length, 1)
      assert.equal((puts(opened)[0]!.body as { menu: unknown[] }).menu.length, editor.defaultCount)
    })

    it('a failed load: the server\'s sentence in role="alert" with "thử lại", never ofetch\'s line; "thử lại" asks again', async () => {
      const opened = await open(editor, server(editor, { [`GET ${editor.url}`]: () => h3Error(403, 'Bạn không có quyền xem cấu hình.') }))
      assert.match(alertText(opened.page), /Bạn không có quyền xem cấu hình\. Vui lòng thử lại\./)
      assert.doesNotMatch(alertText(opened.page), OFETCH_LINE)
      const retry = findAll(opened.page.root, el => el.tag === 'button' && textOf(el) === 'thử lại')[0]!
      const before = opened.calls.length
      await fire(retry, 'click')
      await settle()
      assert.deepEqual(opened.calls.slice(before).map(wire), [`GET ${editor.url}`])
      // A dropped connection (ofetch retries a GET once): the page's own sentence.
      const dead = await open(editor, server(editor, { [`GET ${editor.url}`]: () => dropped() }))
      assert.match(alertText(dead.page), new RegExp(editor.loadFallback.replace(/\./g, '\\.')))
      assert.doesNotMatch(alertText(dead.page), OFETCH_LINE)
    })

    it('FINDING: after a failed load "Lưu cấu hình" is disabled (it PUT the default menu over the real one)', async () => {
      const opened = await open(editor, server(editor, { [`GET ${editor.url}`]: () => h3Error(500, 'Lỗi máy chủ.') }))
      assert.ok(alertText(opened.page))
      assert.equal(disabled(saveButton(opened)), true)
    })

    it('FINDING: after a failed load a click that reaches saveMenu anyway sends nothing', async () => {
      const opened = await open(editor, server(editor, { [`GET ${editor.url}`]: () => h3Error(500, 'Lỗi máy chủ.') }))
      await fire(saveButton(opened), 'click')
      await settle()
      assert.deepEqual(sent(opened.calls).filter(line => typeof line !== 'string'), [])
      assert.equal(puts(opened).length, 0)
    })

    it('FINDING: while the load is in flight "Lưu cấu hình" is disabled and a click sends nothing (it PUT an EMPTY menu)', async () => {
      let pending: NetCall | undefined
      const opened = await open(editor, server(editor, { [`GET ${editor.url}`]: call => { pending = call; return undefined } }))
      assert.ok(pending)
      assert.equal(disabled(saveButton(opened)), true)
      await fire(saveButton(opened), 'click')
      await settle()
      assert.equal(puts(opened).length, 0)
      pending.respond(json({ ok: true, menu: editor.stored }))
      await settle()
      assert.equal(disabled(saveButton(opened)), false)
    })

    it('FINDING: "thử lại" in flight keeps saving locked; its success unlocks it with the stored menu', async () => {
      let fail = true
      let pending: NetCall | undefined
      const opened = await open(editor, server(editor, {
        [`GET ${editor.url}`]: (call) => {
          if (fail) return h3Error(500, 'Lỗi máy chủ.')
          pending = call
          return undefined
        },
      }))
      fail = false
      void fire(findAll(opened.page.root, el => el.tag === 'button' && textOf(el) === 'thử lại')[0]!, 'click')
      await settle()
      assert.ok(pending)
      assert.equal(disabled(saveButton(opened)), true)
      await fire(saveButton(opened), 'click')
      await settle()
      assert.equal(puts(opened).length, 0)
      pending.respond(json({ ok: true, menu: editor.stored }))
      await settle()
      assert.equal(alertText(opened.page), '')
      assert.equal(disabled(saveButton(opened)), false)
      await fire(saveButton(opened), 'click')
      await settle()
      assert.deepEqual((puts(opened)[0]!.body as { menu: Array<{ label: string }> }).menu.map(item => item.label), editor.stored.map(item => item.label))
    })

    it('a refused save toasts the server\'s sentence, never ofetch\'s line, and the button comes back', async () => {
      const opened = await open(editor, server(editor, { [`PUT ${editor.url}`]: () => h3Error(400, 'menu[1].url không phải liên kết được phép.') }))
      await fire(saveButton(opened), 'click')
      await settle()
      assert.equal(opened.lastToast('error'), 'menu[1].url không phải liên kết được phép.')
      const dead = await open(editor, server(editor, { [`PUT ${editor.url}`]: () => dropped() }))
      await fire(saveButton(dead), 'click')
      await settle()
      assert.equal(dead.lastToast('error'), 'Lỗi lưu menu')
      assert.doesNotMatch(dead.lastToast('error') ?? '', OFETCH_LINE)
      assert.equal(disabled(saveButton(dead)), false)
    })
  })
}
