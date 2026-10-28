/**
 * Wave 3 D-FETCH, batch D: the submission detail modal — `components/admin/SubmissionDetailModal.vue`
 * (4 `$fetch` casts) — calls `adminFetch<T>()` with response types derived from the handlers
 * (app/types/admin-submissions-api.ts).
 *
 * Mounted through the REAL list page (`pages/admin/submissions/index.vue`, tests/_admin-page-harness.ts)
 * with the REAL modal registered as its auto-imported `<AdminSubmissionDetailModal>`, both over REAL
 * ofetch on one fake network — so "Xem & xử lý", the close button and the list's reload on
 * `changed` are the page's own. Pinned, green before and after the conversion:
 *   - opening a row asks for that submission; a failure is a `role="alert"` with the server's
 *     sentence and "thử lại";
 *   - each action's request (method, path, JSON body), its toast, then the detail AND the list
 *     reload (`changed`) — the list's badge must follow the modal's status;
 *   - an empty note is refused on the page, without a request.
 *
 * FINDING, RED on the base (fb4751c1): the detail load had no notion of "the current submission".
 * Open #12 on a slow connection, close it, open #13: when #12's answer lands after #13's, citizen
 * A's name, phone and processing log are shown under "Chi tiết Đơn đăng ký #13" — and the note
 * and status buttons under them write to #13. Only the answer for the submission still open is
 * shown now (the ticket pattern of docs/decisions/fetch-rollout-d-fetch.md).
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import * as Vue from 'vue'

import { adminFetch } from '../app/composables/adminFetch.ts'
import { errorMessage, errorStatus } from '../app/utils/errorMessage.ts'
import { byText, click, findAll, input, loadSfc, textOf } from './_sfc-mount.ts'
import {
  alertText, dropped, h3Error, json, mountAdminPage, OFETCH_LINE, routes, sent, settle, unmountAll, wire,
  type MountedAdminPage, type NetCall, type Responder, type Toast,
} from './_admin-page-harness.ts'

afterEach(unmountAll)

type Route = (call: NetCall) => Response | Error | undefined

const LIST = '/api/admin/submissions'
const STAMP = '2026-10-20T02:00:00.000Z'
const row = (id: number, fullName: string, over: Record<string, unknown> = {}) => ({
  id, fullName, phone: `09000000${id}`, email: null, address: 'Tam Hưng', message: `Hoàn cảnh của ${fullName}`, answers: null,
  formTitle: 'Đăng ký hỗ trợ', status: 'new', statusChangedAt: null, statusChangedByName: null, firstViewedAt: null,
  notifiedAt: STAMP, createdAt: STAMP, ...over,
})
const ROWS = [row(12, 'Nguyễn Văn A'), row(13, 'Trần Thị B')]
const listAnswer = (rows = ROWS) => json({ ok: true, submissions: rows, counts: { new: rows.length } })
const detail = (id: number, fullName: string, over: Record<string, unknown> = {}, events: unknown[] = []) =>
  json({ ok: true, submission: row(id, fullName, over), events, firstView: false })
const EVENT = { id: 1, actorId: 1, actorName: 'Cán bộ', actorUsername: 'canbo1', eventType: 'note', fromStatus: null, toStatus: null, channel: null, note: 'Đã gọi, máy bận.', createdAt: STAMP }

function server(overrides: Record<string, Route> = {}): Responder {
  return routes({
    [`GET ${LIST}`]: () => listAnswer(),
    [`GET ${LIST}/12`]: () => detail(12, 'Nguyễn Văn A', {}, [EVENT]),
    [`GET ${LIST}/13`]: () => detail(13, 'Trần Thị B'),
    [`PUT ${LIST}/12/status`]: () => json({ ok: true, status: 'in_progress' }),
    [`POST ${LIST}/12/notes`]: () => json({ ok: true }),
    [`POST ${LIST}/12/contact`]: () => json({ ok: true }),
    ...overrides,
  })
}

/** AdminModal as far as this modal uses it: open/title, its slots, and the × that emits `close`. */
const ClosableModal = Vue.defineComponent({
  props: { open: Boolean, title: String },
  emits: ['close'],
  setup: (props, { slots, emit }) => () => (props.open
    ? Vue.h('div', { role: 'dialog', 'aria-label': props.title }, [
        Vue.h('button', { type: 'button', 'aria-label': 'Đóng hộp thoại', onClick: () => emit('close') }, '×'),
        slots.default?.(), slots.footer?.(),
      ])
    : null),
})

interface Opened extends MountedAdminPage { said: Toast[] }

/**
 * The list page with the real modal as `<AdminSubmissionDetailModal>` (a Nuxt auto-import there).
 * Page and modal share one toast recorder (`said`), so a toast from either is seen.
 */
async function openPage(responder = server()): Promise<Opened> {
  const said: Toast[] = []
  const toast = Object.fromEntries(['success', 'error', 'warning', 'info'].map(type => [type, (message: string) => { said.push({ type, message }) }]))
  const auto = {
    ref: Vue.ref, reactive: Vue.reactive, computed: Vue.computed, watch: Vue.watch, nextTick: Vue.nextTick,
    onMounted: Vue.onMounted, onUnmounted: Vue.onUnmounted, onBeforeUnmount: Vue.onBeforeUnmount,
    useToast: () => toast, errorMessage, errorStatus, adminFetch,
  }
  const modal = Vue.defineAsyncComponent(() => loadSfc(fileURLToPath(new URL('../app/components/admin/SubmissionDetailModal.vue', import.meta.url)), {
    auto, modules: { '~/components/admin/AdminModal.vue': { default: ClosableModal } },
  }))
  const opened = await mountAdminPage('pages/admin/submissions/index.vue', responder, {
    auto: { useToast: () => toast, formatDateTimeVN: (v: unknown) => String(v) },
    components: { AdminSubmissionDetailModal: modal },
  })
  return Object.assign(opened, { said })
}
const dialog = (opened: Opened) => findAll(opened.page.root, el => el.props.role === 'dialog')[0]
/** "Xem & xử lý" on the desktop row of `name` (each row has a mobile card too). */
async function view(opened: Opened, name: string, wait = true) {
  const tr = findAll(opened.page.root, el => el.tag === 'tr' && textOf(el).includes(name))[0]!
  const done = click(byText(tr, 'button', 'Xem & xử lý'))
  if (wait) await done
  await settle()
}
const last = (opened: Opened, type: string) => opened.said.filter(t => t.type === type).at(-1)?.message
const modalText = (opened: Opened) => (dialog(opened) ? textOf(dialog(opened)!) : '')

describe('components/admin/SubmissionDetailModal.vue (through pages/admin/submissions/index.vue)', () => {
  it('opening a row asks for that submission and shows the citizen and the processing log', async () => {
    const opened = await openPage()
    const before = opened.calls.length
    await view(opened, 'Nguyễn Văn A')
    assert.deepEqual(opened.calls.slice(before).map(wire), [`GET ${LIST}/12`])
    assert.equal(dialog(opened)?.props['aria-label'], 'Chi tiết Đơn đăng ký #12')
    const text = modalText(opened)
    assert.match(text, /Nguyễn Văn A/)
    assert.match(text, /0900000012/)
    assert.match(text, /Ghi chú nghiệp vụ/)
    assert.match(text, /Đã gọi, máy bận\./)
    assert.match(text, /Đã gửi email thông báo lúc/)
  })

  it('FINDING: close #12 while it loads, open #13 — #12\'s late answer is not shown under #13', async () => {
    const pending: NetCall[] = []
    const opened = await openPage(server({ [`GET ${LIST}/12`]: (call) => { pending.push(call); return undefined } }))
    await view(opened, 'Nguyễn Văn A', false)
    assert.equal(pending.length, 1)
    // While it loads, the modal's own × is the way out (AdminModal emits `close`).
    await click(findAll(dialog(opened)!, el => el.props['aria-label'] === 'Đóng hộp thoại')[0]!)
    await settle()
    assert.equal(dialog(opened), undefined)
    await view(opened, 'Trần Thị B')
    assert.match(modalText(opened), /Trần Thị B/)
    pending[0]!.respond(detail(12, 'Nguyễn Văn A', {}, [EVENT]))
    await settle()
    assert.equal(dialog(opened)?.props['aria-label'], 'Chi tiết Đơn đăng ký #13')
    assert.doesNotMatch(modalText(opened), /Nguyễn Văn A/, 'citizen A shown under submission #13')
    assert.match(modalText(opened), /Trần Thị B/)
  })

  // Independent verification of batch D (M12): the ticket in catch/finally had no test of its own.
  it('close #12 while it loads, open #13 — #12\'s late FAILURE neither shows an error nor ends #13\'s loading', async () => {
    const pending: NetCall[] = []
    const hold: Route = (call) => { pending.push(call); return undefined }
    const opened = await openPage(server({ [`GET ${LIST}/12`]: hold, [`GET ${LIST}/13`]: hold }))
    await view(opened, 'Nguyễn Văn A', false)
    await click(findAll(dialog(opened)!, el => el.props['aria-label'] === 'Đóng hộp thoại')[0]!)
    await settle()
    await view(opened, 'Trần Thị B', false)
    assert.equal(pending.length, 2)
    pending[0]!.respond(h3Error(403, 'Hồ sơ #12 đã bị khoá.'))
    await settle()
    assert.equal(alertText(opened.page), '', '#12\'s failure shown under #13')
    assert.equal(findAll(dialog(opened)!, el => el.props.role === 'status').length, 1, '#13 is still loading')
    pending[1]!.respond(detail(13, 'Trần Thị B'))
    await settle()
    assert.match(modalText(opened), /Trần Thị B/)
    assert.equal(alertText(opened.page), '')
  })

  it('load failure: the server\'s sentence + "thử lại"; a dropped connection says the fallback', async () => {
    let answer: () => Response | Error = () => h3Error(403, 'Bạn không có quyền xem đơn đăng ký.')
    const opened = await openPage(server({ [`GET ${LIST}/12`]: () => answer() }))
    await view(opened, 'Nguyễn Văn A')
    assert.match(alertText(opened.page), /Bạn không có quyền xem đơn đăng ký\./)
    assert.doesNotMatch(alertText(opened.page), OFETCH_LINE)
    answer = () => detail(12, 'Nguyễn Văn A')
    const before = opened.calls.length
    await click(byText(dialog(opened)!, 'button', 'thử lại'))
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire), [`GET ${LIST}/12`])
    assert.equal(alertText(opened.page), '')
    assert.match(modalText(opened), /Nguyễn Văn A/)

    const offline = await openPage(server({ [`GET ${LIST}/12`]: () => dropped() }))
    await view(offline, 'Nguyễn Văn A')
    assert.match(alertText(offline.page), /Không tải được chi tiết đơn đăng ký\./)
  })

  it('status: PUT {status}, toast, then the detail and the list reload; a refusal says the server\'s sentence', async () => {
    const opened = await openPage()
    await view(opened, 'Nguyễn Văn A')
    const before = opened.calls.length
    await click(byText(dialog(opened)!, 'button', 'Đang xử lý'))
    await settle()
    assert.deepEqual(sent(opened.calls, before), [
      { wire: `PUT ${LIST}/12/status`, body: { status: 'in_progress' } },
      `GET ${LIST}/12`,
      `GET ${LIST}`,
    ])
    assert.equal(last(opened, 'success'), 'Đã chuyển sang "Đang xử lý".')

    const refused = await openPage(server({ [`PUT ${LIST}/12/status`]: () => h3Error(409, 'Đơn đã được người khác chuyển trạng thái.') }))
    await view(refused, 'Nguyễn Văn A')
    await click(byText(dialog(refused)!, 'button', 'Đang xử lý'))
    await settle()
    assert.equal(last(refused, 'error'), 'Đơn đã được người khác chuyển trạng thái.')
  })

  it('note: empty is refused without a request; POST {note}, the draft clears, reloads; contact: POST {channel}', async () => {
    const opened = await openPage()
    await view(opened, 'Nguyễn Văn A')
    let before = opened.calls.length
    await click(byText(dialog(opened)!, 'button', 'Lưu ghi chú'))
    await settle()
    assert.equal(opened.calls.length, before)
    assert.equal(last(opened, 'error'), 'Vui lòng nhập nội dung ghi chú.')

    const note = findAll(dialog(opened)!, el => el.tag === 'textarea')[0]!
    await input(note, '  Đã chuyển hồ sơ cho Công an xã.  ')
    await click(byText(dialog(opened)!, 'button', 'Lưu ghi chú'))
    await settle()
    assert.deepEqual(sent(opened.calls, before), [
      { wire: `POST ${LIST}/12/notes`, body: { note: 'Đã chuyển hồ sơ cho Công an xã.' } },
      `GET ${LIST}/12`,
      `GET ${LIST}`,
    ])
    assert.equal(last(opened, 'success'), 'Đã lưu ghi chú.')
    assert.equal(findAll(dialog(opened)!, el => el.tag === 'textarea')[0]!.model?.value, '')

    before = opened.calls.length
    await click(byText(dialog(opened)!, 'button', 'Ghi nhận'))
    await settle()
    assert.deepEqual(sent(opened.calls, before), [
      { wire: `POST ${LIST}/12/contact`, body: { channel: 'phone' } },
      `GET ${LIST}/12`,
      `GET ${LIST}`,
    ])
    assert.equal(last(opened, 'success'), 'Đã ghi nhận lượt liên hệ.')

    const refused = await openPage(server({ [`POST ${LIST}/12/contact`]: () => dropped() }))
    await view(refused, 'Nguyễn Văn A')
    await click(byText(dialog(refused)!, 'button', 'Ghi nhận'))
    await settle()
    assert.equal(last(refused, 'error'), 'Không thể ghi nhận lượt liên hệ.')
  })
})
