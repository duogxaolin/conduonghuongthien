/**
 * Wave 3 D-FETCH, batch F: the video library's three forms — `pages/admin/media-portal/external.vue`
 * (2 `$fetch` casts), `…/upload.vue` (1), `components/admin/MediaPortalForm.vue` (1) — and the
 * chunked uploader's request adapter, `components/admin/ChunkedUploader.vue` (1), call
 * `adminFetch<T>()` with types from app/types/admin-media-portal-api.ts / admin-api.ts.
 *
 * The REAL components are mounted over REAL ofetch on a fake network. Pinned, green before and
 * after the conversion:
 *   - external.vue: the config GET (only with `media_portal.create`), the POST of the form's
 *     fields, the success toast and the move to the new draft; a refusal in the form's alert;
 *   - upload.vue: 403 on the config reads "no permission" (not an error with "Thử lại"), any
 *     other failure the error with "Thử lại", `uploadEnabled: false` the disabled notice;
 *   - MediaPortalForm "Lấy thông tin": POST `{ url }`, the title filled only when empty, the
 *     link normalised to the id, the two `reason`s and a refusal in the form's alert;
 *   - ChunkedUploader: the `request` it hands the upload session sends method, JSON or binary
 *     body and headers on the wire, answers the parsed body, and rejects with the status and
 *     the server's sentence the session reads (409 = assembly owned by another request).
 *
 * FINDINGS, RED on the base (551651c7):
 *   - MediaPortalForm: the link field stays editable while YouTube answers; an answer for a
 *     link the officer had since replaced wrote ITS video id back into the field (and its
 *     title into an empty title) — the draft then saved the OLD video. Dropped now; its
 *     failure is dropped too;
 *   - external.vue: a failed config read showed a fixed sentence, never the server's
 *     (`catch {}` — the D-FETCH rule is `errorMessage(err, fallback)`).
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import * as Vue from 'vue'

import { fire, findAll, textOf, type MiniElement } from './_sfc-mount.ts'
import {
  alertText, dropped, h3Error, json, mountAdminPage, OFETCH_LINE, routes, sent, settle, unmountAll, wire,
  type MountedAdminPage, type NetCall, type Responder,
} from './_admin-page-harness.ts'
import { errorMessage } from '../app/utils/errorMessage.ts'

afterEach(unmountAll)

type Route = (call: NetCall) => Response | Error | undefined
const CONFIG = { ok: true, uploadEnabled: true, maxUploadSize: 2 * 1024 ** 3, categories: [{ id: 3, name: 'Phóng sự' }] }

// ─── pages/admin/media-portal/external.vue ──────────────────────────────────

const EXTERNAL = 'pages/admin/media-portal/external.vue'
function externalServer(overrides: Record<string, Route> = {}): Responder {
  return routes({
    'GET /api/admin/media-portal/config': () => json(CONFIG),
    'POST /api/admin/media-portal/external': () => json({ ok: true, id: 41, slug: 'video-moi', shortId: 'abc123' }),
    ...overrides,
  })
}
async function openExternal(responder = externalServer(), can: (resource: string, action: string) => boolean = () => true) {
  const navigations: unknown[] = []
  const opened = await mountAdminPage(EXTERNAL, responder, { can, auto: { navigateTo: async (to: unknown) => { navigations.push(to) } } })
  return Object.assign(opened, { navigations })
}
const form = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'AdminMediaPortalForm')[0]
const FIELDS = { title: 'Phóng sự', description: 'Mô tả', categoryId: 3, youtubeVideoId: 'dQw4w9WgXcQ' }

describe(EXTERNAL, () => {
  it('mount: the config GET; the form gets its categories', async () => {
    const opened = await openExternal()
    assert.deepEqual(opened.calls.map(wire), ['GET /api/admin/media-portal/config'])
    assert.deepEqual(form(opened)!.props.categories, CONFIG.categories)
  })

  it('without media_portal.create: no request, the permission notice', async () => {
    const opened = await openExternal(externalServer(), (resource, action) => !(resource === 'media_portal' && action === 'create'))
    assert.deepEqual(opened.calls, [])
    assert.match(alertText(opened.page), /Bạn chưa được cấp quyền tạo video\./)
  })

  it('submit: POSTs the fields, toasts, shows "created" and goes to the new draft', async () => {
    const opened = await openExternal()
    await fire(form(opened)!, 'submit', FIELDS)
    await settle()
    assert.deepEqual(sent(opened.calls, 1), [{ wire: 'POST /api/admin/media-portal/external', body: FIELDS }])
    assert.equal(opened.lastToast('success'), 'Đã tạo bản nháp video.')
    assert.deepEqual(opened.navigations, ['/admin/media-portal/41'])
  })

  it('a refused submit: the server\'s sentence in the form\'s alert; a dropped one the page\'s; never ofetch\'s line', async () => {
    const opened = await openExternal(externalServer({ 'POST /api/admin/media-portal/external': () => h3Error(400, 'Mã video YouTube không hợp lệ.') }))
    await fire(form(opened)!, 'submit', FIELDS)
    await settle()
    assert.equal(alertText(opened.page), 'Mã video YouTube không hợp lệ.')
    const dead = await openExternal(externalServer({ 'POST /api/admin/media-portal/external': () => dropped() }))
    await fire(form(dead)!, 'submit', FIELDS)
    await settle()
    assert.equal(alertText(dead.page), 'Không tạo được video. Kiểm tra thông tin rồi thử lại.')
    assert.equal(dead.calls.filter(call => call.method === 'POST').length, 1, 'retry: 0 — one POST')
  })

  it('FINDING: a failed config read shows the server\'s sentence with "Thử lại" (it always showed a fixed one)', async () => {
    const opened = await openExternal(externalServer({ 'GET /api/admin/media-portal/config': () => h3Error(503, 'Kho video đang bảo trì.') }))
    assert.match(alertText(opened.page), /^Kho video đang bảo trì\. Thử lại$/)
    const dead = await openExternal(externalServer({ 'GET /api/admin/media-portal/config': () => dropped() }))
    assert.match(alertText(dead.page), /^Không tải được thông tin biểu mẫu\. Thử lại$/)
    assert.doesNotMatch(alertText(dead.page), OFETCH_LINE)
  })
})

// ─── pages/admin/media-portal/upload.vue ────────────────────────────────────

const UPLOAD = 'pages/admin/media-portal/upload.vue'
const openUpload = (route: Route) => mountAdminPage(UPLOAD, routes({ 'GET /api/admin/media-portal/config': route }), {
  modules: { '../../../composables/mediaProcessingMessage': { mediaProcessingMessage: () => '' } },
  auto: { navigateTo: async () => {}, onBeforeUnmount: Vue.onBeforeUnmount },
})
const uploader = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'AdminChunkedUploader')[0]

describe(UPLOAD, () => {
  it('mount: the config GET; the uploader gets the size limit', async () => {
    const opened = await openUpload(() => json(CONFIG))
    assert.deepEqual(opened.calls.map(wire), ['GET /api/admin/media-portal/config'])
    assert.equal(uploader(opened)!.props['max-upload-size'] ?? uploader(opened)!.props.maxUploadSize, CONFIG.maxUploadSize)
  })

  it('403 reads as "no permission"; another failure as an error with "Thử lại"; upload switched off as its notice', async () => {
    const denied = await openUpload(() => h3Error(403, 'Bạn không có quyền.'))
    assert.ok(!uploader(denied))
    assert.doesNotMatch(alertText(denied.page), /Không kiểm tra được/)
    const failed = await openUpload(() => h3Error(400, 'Lỗi.'))
    assert.match(alertText(failed.page), /Không kiểm tra được khả năng tải video của máy chủ\./)
    assert.ok(findAll(failed.page.root, el => el.tag === 'button' && textOf(el) === 'Thử lại').length === 1)
    const off = await openUpload(() => json({ ...CONFIG, uploadEnabled: false }))
    assert.ok(!uploader(off))
    assert.equal(alertText(off.page), '')
  })
})

// ─── components/admin/MediaPortalForm.vue ───────────────────────────────────

const FORM = 'components/admin/MediaPortalForm.vue'
const META = '/api/admin/media-portal/youtube-meta'
const metaOk = (videoId: string, title: string) => json({ ok: true, title, authorName: 'Kênh', thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hq.jpg`, videoId })
const openForm = (route: Route) => mountAdminPage(FORM, routes({ [`POST ${META}`]: route }), { props: { categories: [], saving: false } })
const linkInput = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'input' && el.props.id === 'media-youtube')[0]!
const titleInput = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'input' && el.props.id === 'media-title')[0]!
const fetchButton = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'button' && /Lấy thông tin|Đang lấy/.test(textOf(el)))[0]!
async function typeLink(opened: MountedAdminPage, value: string) {
  await fire(linkInput(opened), 'update:modelValue', value)
  await settle()
}

describe(FORM, () => {
  it('"Lấy thông tin": POSTs the link; fills an empty title, the preview, and normalises the link to the id', async () => {
    const opened = await openForm(() => metaOk('dQw4w9WgXcQ', 'Bài hát'))
    await typeLink(opened, ' https://youtu.be/dQw4w9WgXcQ ')
    await fire(fetchButton(opened), 'click')
    await settle()
    assert.deepEqual(sent(opened.calls), [{ wire: `POST ${META}`, body: { url: 'https://youtu.be/dQw4w9WgXcQ' } }])
    assert.equal(titleInput(opened).model?.value, 'Bài hát')
    assert.equal(linkInput(opened).model?.value, 'dQw4w9WgXcQ')
    assert.match(textOf(opened.page.root), /Kênh/)
  })

  it('a title already typed is kept; the two reasons and a refusal read in the alert, never ofetch\'s line', async () => {
    const opened = await openForm(() => metaOk('abc', 'Tiêu đề YouTube'))
    await fire(titleInput(opened), 'update:modelValue', 'Tiêu đề của cán bộ')
    await typeLink(opened, 'abc')
    await fire(fetchButton(opened), 'click')
    await settle()
    assert.equal(titleInput(opened).model?.value, 'Tiêu đề của cán bộ')
    const said = async (route: Route) => {
      const form = await openForm(route)
      await typeLink(form, 'xyz')
      await fire(fetchButton(form), 'click')
      await settle()
      return alertText(form.page)
    }
    assert.equal(await said(() => json({ ok: false, reason: 'invalid' })), 'Địa chỉ video không hợp lệ hoặc không được hỗ trợ.')
    assert.equal(await said(() => json({ ok: false, reason: 'fetch_failed' })), 'Không lấy được thông tin từ YouTube. Kiểm tra lại liên kết hoặc thử lại.')
    assert.equal(await said(() => h3Error(429, 'Bạn thao tác quá nhanh.')), 'Bạn thao tác quá nhanh.')
    const dead = await said(() => dropped())
    assert.equal(dead, 'Không lấy được thông tin từ YouTube.')
  })

  it('FINDING: an answer for a link the officer has since replaced does not write its id (or title) back', async () => {
    let pending: NetCall | undefined
    const opened = await openForm((call) => { pending = call; return undefined })
    await typeLink(opened, 'https://youtu.be/AAAAAAAAAAA')
    void fire(fetchButton(opened), 'click')
    await settle()
    await typeLink(opened, 'https://youtu.be/BBBBBBBBBBB')
    pending!.respond(metaOk('AAAAAAAAAAA', 'Video A'))
    await settle()
    assert.equal(linkInput(opened).model?.value, 'https://youtu.be/BBBBBBBBBBB')
    assert.equal(titleInput(opened).model?.value, '')
    assert.doesNotMatch(textOf(opened.page.root), /Kênh/)
    assert.equal(textOf(fetchButton(opened)), 'Lấy thông tin')
  })

  it('FINDING: a failure for a link the officer has since replaced is not shown under the new link', async () => {
    let pending: NetCall | undefined
    const opened = await openForm((call) => { pending = call; return undefined })
    await typeLink(opened, 'AAAAAAAAAAA')
    void fire(fetchButton(opened), 'click')
    await settle()
    await typeLink(opened, 'BBBBBBBBBBB')
    pending!.respond(json({ ok: false, reason: 'invalid' }))
    await settle()
    assert.equal(alertText(opened.page), '')
    pending = undefined
    // A refusal (thrown) for the replaced link is dropped the same way.
    const thrown = await openForm((call) => { pending = call; return undefined })
    await typeLink(thrown, 'AAAAAAAAAAA')
    void fire(fetchButton(thrown), 'click')
    await settle()
    await typeLink(thrown, 'BBBBBBBBBBB')
    pending!.respond(h3Error(400, 'Liên kết A hỏng.'))
    await settle()
    assert.equal(alertText(thrown.page), '')
  })
})

// ─── components/admin/ChunkedUploader.vue — the `request` it hands the session ───

describe('components/admin/ChunkedUploader.vue', () => {
  type Request = <T>(url: string, options?: Record<string, unknown>) => Promise<T>
  async function adapter(responder: Responder): Promise<{ request: Request, calls: NetCall[] }> {
    let request: Request | undefined
    const session = {
      useMediaUploadSession: (options: { request: Request }) => {
        request = options.request
        return { state: Vue.reactive({ phase: 'idle', received: 0, total: 0 }), pause: () => {}, select: async () => {}, start: async () => {}, discard: () => {} }
      },
    }
    const opened = await mountAdminPage('components/admin/ChunkedUploader.vue', responder, {
      props: { open: true, maxUploadSize: 1024 },
      modules: { '../../composables/useMediaUploadSession': session },
      auto: { shallowRef: Vue.shallowRef, watchEffect: Vue.watchEffect },
    })
    assert.ok(request, `the uploader created its session (${opened.page.errors.map(String).join('; ')})`)
    return { request, calls: opened.calls }
  }
  const BASE = '/api/admin/media-portal/upload/u1'

  it('JSON and binary bodies, headers and the parsed answer go through unchanged', async () => {
    const { request, calls } = await adapter(routes({
      'POST /api/admin/media-portal/upload/init': () => json({ ok: true, uploadId: 'u1' }),
      [`PUT ${BASE}/chunk`]: () => json({ ok: true, receivedParts: [0] }),
    }))
    const init = await request<{ uploadId: string }>('/api/admin/media-portal/upload/init', { method: 'POST', body: { filename: 'a.mp4', declaredSize: 3 }, retry: 0 })
    assert.equal(init.uploadId, 'u1')
    const bytes = new Uint8Array([1, 2, 3]).buffer
    const part = await request<{ receivedParts: number[] }>(`${BASE}/chunk?index=0`, { method: 'PUT', body: bytes, headers: { 'Content-Type': 'application/octet-stream' }, retry: 0 })
    assert.deepEqual(part.receivedParts, [0])
    assert.deepEqual(calls.map(wire), ['POST /api/admin/media-portal/upload/init', `PUT ${BASE}/chunk?index=0`])
    assert.deepEqual(calls[0]!.body, { filename: 'a.mp4', declaredSize: 3 })
    assert.ok(calls[1]!.body instanceof ArrayBuffer)
    assert.deepEqual([...new Uint8Array(calls[1]!.body as ArrayBuffer)], [1, 2, 3])
  })

  it('a refusal rejects with the status the session reads and the server\'s sentence', async () => {
    const { request } = await adapter(routes({ [`POST ${BASE}/complete`]: () => h3Error(409, 'Một yêu cầu khác đang ghép tệp.') }))
    const error = await request(`${BASE}/complete`, { method: 'POST', retry: 0 }).then(() => null, (err: unknown) => err)
    assert.equal((error as { statusCode?: number }).statusCode, 409)
    assert.equal(errorMessage(error, 'x'), 'Một yêu cầu khác đang ghép tệp.')
  })
})
