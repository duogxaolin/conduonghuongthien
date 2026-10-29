/**
 * Wave 3 D-FETCH, batch F: the image side of the admin — `components/admin/MediaLibraryModal.vue`
 * (the picker, 1 `$fetch` cast), `composables/useUpload.ts` (2) and
 * `components/admin/TinyMceEditor.vue`'s image upload (1) — call `adminFetch<T>()` with
 * `AdminMediaListResponse` (app/types/admin-media-api.ts) / `AdminMediaUploadResult`
 * (app/types/admin-api.ts), both derived from the handlers.
 *
 * Real components / real composable source over REAL ofetch on a fake network. Pinned, green
 * before and after: the picker's GET on opening (search, 20 per page, the page), Enter in the
 * search box, a failure in its `role="alert"` (the server's sentence) and as a toast; the
 * uploads' POST of a `FormData` with the file, the media returned, the server's sentence on a
 * refusal (as a task error / toast / the editor's rejection).
 *
 * FINDINGS, RED on the base (551651c7):
 *   - the picker read the page count from a top-level `totalPages` that
 *     `GET /api/admin/media` never sends (it answers `pagination.totalPages`) — the count was
 *     always 1, so the pager never appeared and every image past the 20 newest could only be
 *     reached by searching its file name. The derived type makes `res.totalPages` a type error;
 *   - no notion of "the latest request": search, then search again (or a page click) before the
 *     first answer — the older answer landing last showed the first search's images under the
 *     second; its failure put an error over them; its `finally` ended the loading state early.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { afterEach, describe, it } from 'node:test'
import * as Vue from 'vue'

import { fire, findAll, textOf } from './_sfc-mount.ts'
import {
  alertText, dropped, h3Error, installNetwork, json, mountAdminPage, OFETCH_LINE, OpenModal, routes, settle, unmountAll, wire,
  type MountedAdminPage, type NetCall, type Responder,
} from './_admin-page-harness.ts'
import { adminFetch } from '../app/composables/adminFetch.ts'
import { errorMessage } from '../app/utils/errorMessage.ts'

afterEach(unmountAll)

type Route = (call: NetCall) => Response | Error | undefined
const LIST = '/api/admin/media'
const image = (id: number, name: string) => ({ id, filename: `${name}.webp`, originalName: `${name}.jpg`, mimeType: 'image/webp', sizeBytes: 10, provider: 'local', url: `/uploads/${name}.webp`, width: 10, height: 10, createdAt: null, uploadedBy: 1 })
const page = (items: unknown[], totalPages = 1, current = 1) => json({ ok: true, items, pagination: { page: current, perPage: 20, total: items.length, totalPages } })

// ─── components/admin/MediaLibraryModal.vue ─────────────────────────────────

const PICKER = 'components/admin/MediaLibraryModal.vue'
async function openPicker(route: Route) {
  const isOpen = Vue.ref(false)
  const picker = { isOpen, isMultiple: Vue.ref(false), closePicker: () => { isOpen.value = false }, handleSelect: () => {}, handleSelectMultiple: () => {} }
  const uploader = { uploading: Vue.ref(false), uploadBatch: async () => [], tasks: Vue.ref([]), uploadingBatch: Vue.ref(false) }
  const opened = await mountAdminPage(PICKER, routes({ [`GET ${LIST}`]: route }), {
    modules: { '~/components/admin/AdminModal.vue': { default: OpenModal } },
    auto: { useImagePicker: () => picker, useUpload: () => uploader },
  })
  isOpen.value = true
  await settle()
  return opened
}
const shown = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'img' && /\.jpg$/.test(String(el.props.alt))).map(el => el.props.alt)
const searchBox = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'input' && el.props['aria-label'] === 'Tìm ảnh theo tên file')[0]!
const enter = { key: 'Enter', isComposing: false, keyCode: 13, preventDefault() {} }
async function search(opened: MountedAdminPage, text: string) {
  await fire(searchBox(opened), 'update:modelValue', text)
  void fire(searchBox(opened), 'keydown', enter)
  await settle()
}
const nextButton = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'button' && el.props['aria-label'] === 'Trang sau')[0]

describe(PICKER, () => {
  it('opening asks for page 1 (empty search, 20 per page); Enter in the search box asks with the text', async () => {
    const opened = await openPicker(() => page([image(1, 'anh-mot')]))
    // ufo writes an empty value as a bare key — the same wire as the base's `params:`.
    assert.deepEqual(opened.calls.map(wire), [`GET ${LIST}?search&perPage=20&page=1`])
    assert.deepEqual(shown(opened), ['anh-mot.jpg'])
    await search(opened, 'mot')
    assert.deepEqual(opened.calls.slice(1).map(wire), [`GET ${LIST}?search=mot&perPage=20&page=1`])
  })

  it('a failed load: the server\'s sentence in role="alert" and as a toast; a dropped one the page\'s; never ofetch\'s line', async () => {
    const opened = await openPicker(() => h3Error(403, 'Bạn không có quyền xem thư viện.'))
    assert.match(alertText(opened.page), /Bạn không có quyền xem thư viện\./)
    assert.equal(opened.lastToast('error'), 'Bạn không có quyền xem thư viện.')
    const dead = await openPicker(() => dropped())
    assert.match(alertText(dead.page), /Lỗi tải thư viện media/)
    assert.doesNotMatch(alertText(dead.page), OFETCH_LINE)
  })

  it('FINDING: more than one page shows the pager from `pagination.totalPages`; "Trang sau" asks for page 2', async () => {
    const opened = await openPicker(call => page([image(Number(call.url.searchParams.get('page')), `anh-${call.url.searchParams.get('page')}`)], 3, Number(call.url.searchParams.get('page'))))
    assert.ok(nextButton(opened), 'the pager is shown')
    assert.match(textOf(opened.page.root), /1 \/ 3/)
    await fire(nextButton(opened)!, 'click')
    await settle()
    assert.equal(wire(opened.calls.at(-1)!), `GET ${LIST}?search&perPage=20&page=2`)
    assert.deepEqual(shown(opened), ['anh-2.jpg'])
  })

  it('page 2 failing: the pager stays on the page shown ("1 / 3", never "2 / 3"); "Thử lại" reloads that page, "Trang sau" asks for 2 again', async () => {
    // KNOWN, kept: "Thử lại" reloads the page SHOWN (1), not the page whose load failed (2) — the page
    // number moves only once a page has arrived, so the pager never names a page whose images are not
    // on screen. The officer presses "Trang sau" again (lot E noted the same for the library page).
    let failPage2 = true
    const opened = await openPicker((call) => {
      const asked = Number(call.url.searchParams.get('page'))
      if (asked === 2 && failPage2) return h3Error(403, 'Không đọc được trang 2.')
      return page([image(asked, `anh-${asked}`)], 3, asked)
    })
    await fire(nextButton(opened)!, 'click')
    await settle()
    assert.match(alertText(opened.page), /Không đọc được trang 2\./)
    assert.match(textOf(opened.page.root), /1 \/ 3/)
    assert.doesNotMatch(textOf(opened.page.root), /2 \/ 3/)
    const before = opened.calls.length
    await fire(findAll(opened.page.root, el => el.tag === 'button' && textOf(el).includes('Thử lại'))[0]!, 'click')
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire), [`GET ${LIST}?search&perPage=20&page=1`])
    assert.deepEqual(shown(opened), ['anh-1.jpg'])
    failPage2 = false
    await fire(nextButton(opened)!, 'click')
    await settle()
    assert.match(textOf(opened.page.root), /2 \/ 3/)
    assert.deepEqual(shown(opened), ['anh-2.jpg'])
  })

  it('FINDING: the older search\'s answer landing last does not replace the newer one\'s images', async () => {
    const pending: NetCall[] = []
    let first = true
    const opened = await openPicker((call) => { if (first) { first = false; return page([image(9, 'mount')]) } pending.push(call); return undefined })
    await search(opened, 'a')
    await search(opened, 'ab')
    pending[1]!.respond(page([image(2, 'ab')]))
    await settle()
    pending[0]!.respond(page([image(1, 'a')]))
    await settle()
    assert.deepEqual(shown(opened), ['ab.jpg'])
  })

  it('FINDING: the older search failing last puts no error over the newer images', async () => {
    const pending: NetCall[] = []
    let first = true
    const opened = await openPicker((call) => { if (first) { first = false; return page([image(9, 'mount')]) } pending.push(call); return undefined })
    await search(opened, 'a')
    await search(opened, 'ab')
    pending[1]!.respond(page([image(2, 'ab')]))
    await settle()
    pending[0]!.respond(h3Error(403, 'Lỗi cũ.'))
    await settle()
    assert.equal(alertText(opened.page), '')
    assert.deepEqual(shown(opened), ['ab.jpg'])
  })

  it('FINDING: the older search settling first keeps loading until the newer one is back', async () => {
    const pending: NetCall[] = []
    let first = true
    const opened = await openPicker((call) => { if (first) { first = false; return page([image(9, 'mount')]) } pending.push(call); return undefined })
    await search(opened, 'a')
    await search(opened, 'ab')
    pending[0]!.respond(page([image(1, 'a')]))
    await settle()
    assert.deepEqual(shown(opened), [], 'the older search\'s images are not shown')
    pending[1]!.respond(page([image(2, 'ab')]))
    await settle()
    assert.deepEqual(shown(opened), ['ab.jpg'])
  })
})

// ─── composables/useUpload.ts — its source, compiled with the auto-imports it uses ───

type UploadApi = {
  uploadFile: (file: File) => Promise<{ id: number, url: string } | null>
  uploadBatch: (files: File[], concurrency?: number) => Promise<Array<{ id: number }>>
  tasks: Vue.Ref<Array<{ status: string, error: string }>>
}
function loadUseUpload(responder: Responder) {
  const calls = installNetwork(responder)
  const toasts: Array<{ type: string, message: string }> = []
  const toast = Object.fromEntries(['success', 'error', 'warning', 'info'].map(type => [type, (message: string) => { toasts.push({ type, message }) }]))
  const source = stripTypeScriptTypes(readFileSync(new URL('../app/composables/useUpload.ts', import.meta.url), 'utf8'))
    .replace(/export (const|function) /g, '$1 ')
  const names = ['ref', 'useToast', 'errorMessage', 'adminFetch']
  const useUpload = new Function(...names, `${source}\nreturn useUpload`)(Vue.ref, () => toast, errorMessage, adminFetch) as () => UploadApi
  return { upload: useUpload(), calls, toasts }
}
const UPLOAD = '/api/admin/media/upload'
const stored = { ok: true, media: { id: 7, filename: 'a.webp', originalName: 'a.jpg', mimeType: 'image/webp', sizeBytes: 3, provider: 'local', url: '/uploads/a.webp', width: 1, height: 1 } }
const file = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' })

describe('composables/useUpload.ts', () => {
  it('uploadFile POSTs a FormData with the file and returns the stored media', async () => {
    const { upload, calls } = loadUseUpload(routes({ [`POST ${UPLOAD}`]: () => json(stored) }))
    const media = await upload.uploadFile(file('a.jpg'))
    assert.deepEqual(calls.map(wire), [`POST ${UPLOAD}`])
    assert.ok(calls[0]!.body instanceof FormData)
    assert.equal(((calls[0]!.body as FormData).get('file') as File).name, 'a.jpg')
    assert.equal(media?.id, 7)
  })

  it('uploadFile: a refusal toasts the server\'s sentence, a dropped one the fallback, and returns null', async () => {
    const refused = loadUseUpload(routes({ [`POST ${UPLOAD}`]: () => h3Error(415, 'Định dạng tệp không được hỗ trợ.') }))
    assert.equal(await refused.upload.uploadFile(file('a.svg')), null)
    assert.deepEqual(refused.toasts, [{ type: 'error', message: 'Định dạng tệp không được hỗ trợ.' }])
    const dead = loadUseUpload(routes({ [`POST ${UPLOAD}`]: () => dropped() }))
    assert.equal(await dead.upload.uploadFile(file('a.jpg')), null)
    assert.deepEqual(dead.toasts, [{ type: 'error', message: 'Upload thất bại' }])
  })

  it('uploadBatch: one POST per file; a refused file carries the server\'s sentence, the rest succeed', async () => {
    const { upload, calls } = loadUseUpload(routes({
      [`POST ${UPLOAD}`]: call => (((call.body as FormData).get('file') as File).name === 'x.svg'
        ? h3Error(415, 'Định dạng tệp không được hỗ trợ.') : json(stored)),
    }))
    const done = await upload.uploadBatch([file('a.jpg'), file('x.svg')], 2)
    assert.equal(calls.length, 2)
    assert.equal(done.length, 1)
    assert.deepEqual(upload.tasks.value.map(task => [task.status, task.error]), [['success', ''], ['error', 'Định dạng tệp không được hỗ trợ.']])
  })
})

// ─── components/admin/TinyMceEditor.vue — the editor's image upload ─────────

describe('components/admin/TinyMceEditor.vue', () => {
  type Handler = (blob: { blob: () => Blob, filename: () => string }) => Promise<string>
  async function uploadHandler(route: Route): Promise<{ handler: Handler, calls: NetCall[] }> {
    let options: { images_upload_handler?: Handler } = {}
    const opened = await mountAdminPage('components/admin/TinyMceEditor.vue', routes({ [`POST ${UPLOAD}`]: route }), {
      auto: { window: { tinymce: { init: (given: typeof options) => { options = given } } } },
    })
    assert.ok(options.images_upload_handler, 'the editor was initialised with an upload handler')
    return { handler: options.images_upload_handler, calls: opened.calls }
  }
  const blobInfo = { blob: () => new Blob([new Uint8Array([1])], { type: 'image/png' }), filename: () => 'dan.png' }

  it('a pasted image is POSTed as `file` and the editor gets the stored URL', async () => {
    const { handler, calls } = await uploadHandler(() => json(stored))
    assert.equal(await handler(blobInfo), '/uploads/a.webp')
    assert.deepEqual(calls.map(wire), [`POST ${UPLOAD}`])
    assert.equal(((calls[0]!.body as FormData).get('file') as File).name, 'dan.png')
  })

  it('a refusal rejects with the server\'s sentence; a dropped one with the fallback; never ofetch\'s line', async () => {
    const refused = await uploadHandler(() => h3Error(413, 'Ảnh quá lớn.'))
    await assert.rejects(refused.handler(blobInfo), (reason: unknown) => reason === 'Ảnh quá lớn.')
    const dead = await uploadHandler(() => dropped())
    await assert.rejects(dead.handler(blobInfo), (reason: unknown) => reason === 'Upload thất bại')
    const noUrl = await uploadHandler(() => json({ ok: true, media: { ...stored.media, url: '' } }))
    await assert.rejects(noUrl.handler(blobInfo), (reason: unknown) => reason === 'Upload thất bại' && !OFETCH_LINE.test(String(reason)))
  })
})
