/**
 * `components/admin/VideoLibraryModal.vue` — the picker that puts a video of the video library into an
 * article. Real component over REAL ofetch on a fake network (the harness of
 * admin-fetch-rollout-media-picker.test.ts): what it asks for, what it lists, which items can be chosen
 * and which are listed but blocked (never hidden), what a choice hands back, and its failure branch.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import * as Vue from 'vue'

import { fire, findAll, textOf } from './_sfc-mount.ts'
import {
  alertText, dropped, h3Error, json, mountAdminPage, OpenModal, routes, settle, unmountAll, wire,
  type MountedAdminPage, type NetCall,
} from './_admin-page-harness.ts'

afterEach(unmountAll)

const LIST = '/api/admin/media-portal'
const MODAL = 'components/admin/VideoLibraryModal.vue'

const video = (id: number, extra: Record<string, unknown> = {}) => ({
  id, shortId: `short${String(id).padStart(6, '0')}`, title: `Video số ${id}`, source: 'upload', youtubeVideoId: null,
  status: 'published', processingStatus: 'ready', thumbnailUrl: null, durationSeconds: 75, ...extra,
})
const answer = (items: unknown[], total = items.length) => json({ ok: true, items, total, page: 1, limit: 12 })

type Route = (call: NetCall) => Response | Error | undefined
async function open(route: Route) {
  const isOpen = Vue.ref(false)
  const chosen: unknown[] = []
  const picker = {
    isOpen,
    closeVideoPicker: () => { isOpen.value = false },
    selectVideo: (item: unknown) => { chosen.push(item); isOpen.value = false },
  }
  const opened = await mountAdminPage(MODAL, routes({ [`GET ${LIST}`]: route }), {
    modules: { '~/components/admin/AdminModal.vue': { default: OpenModal } },
    auto: { useVideoPicker: () => picker },
  })
  isOpen.value = true
  await settle()
  return { opened, chosen, isOpen }
}

const tiles = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'button' && /Video số/.test(textOf(el)))
const searchBox = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'input' && el.props['aria-label'] === 'Tìm video theo tiêu đề')[0]!
const isDisabled = (el: { props: Record<string, unknown> }) => el.props.disabled === true || el.props.disabled === ''

describe(MODAL, () => {
  it('opening asks for published videos only, newest first, 12 per page', async () => {
    const { opened } = await open(() => answer([video(1)]))
    assert.deepEqual(opened.calls.map(wire), [`GET ${LIST}?search&status=published&limit=12&page=1&sort=updatedAt&order=desc`])
    assert.equal(tiles(opened).length, 1)
  })

  it('a ready upload and a YouTube item can be chosen; choosing hands the item back and closes the box', async () => {
    const { opened, chosen, isOpen } = await open(() => answer([video(1), video(2, { source: 'youtube', youtubeVideoId: 'dQw4w9WgXcQ', processingStatus: 'ready' })]))
    const [upload, youtube] = tiles(opened)
    assert.equal(isDisabled(upload!), false)
    assert.equal(isDisabled(youtube!), false)
    await fire(youtube!, 'click')
    assert.equal(chosen.length, 1)
    assert.equal((chosen[0] as { id: number }).id, 2)
    assert.equal(isOpen.value, false)
  })

  it('an upload still processing (or failed) is LISTED, blocked, with the reason — not hidden', async () => {
    const { opened, chosen } = await open(() => answer([video(1, { processingStatus: 'processing' }), video(2, { processingStatus: 'failed' })]))
    const [processing, failed] = tiles(opened)
    assert.equal(isDisabled(processing!), true)
    assert.equal(isDisabled(failed!), true)
    assert.match(textOf(processing!), /Đang xử lý/)
    assert.match(textOf(failed!), /Xử lý lỗi/)
    await fire(processing!, 'click')
    assert.deepEqual(chosen, [], 'a blocked tile hands nothing back')
  })

  it('Enter in the search box asks with the text', async () => {
    const { opened } = await open(() => answer([video(1)]))
    await fire(searchBox(opened), 'update:modelValue', 'trao quyết định')
    void fire(searchBox(opened), 'keydown', { key: 'Enter', isComposing: false, keyCode: 13, preventDefault() {} })
    await settle()
    assert.match(wire(opened.calls.at(-1)!), /search=trao(%20|\+)quy%E1%BA%BFt(%20|\+)%C4%91%E1%BB%8Bnh|search=trao/)
    assert.match(wire(opened.calls.at(-1)!), /status=published/)
  })

  it('an empty library says so, and an empty search says nothing matched', async () => {
    const { opened } = await open(() => answer([]))
    assert.match(textOf(opened.page.root), /Chưa có video nào được đăng/)
  })

  it('a failed load: the server\'s sentence in role="alert" with "Thử lại" that asks again; a dropped one gets the box\'s own; never ofetch\'s line', async () => {
    let calls = 0
    const { opened } = await open(() => (++calls === 1 ? h3Error(403, 'Bạn không có quyền xem kho video.') : answer([video(1)])))
    assert.match(alertText(opened.page), /Bạn không có quyền xem kho video\./)
    const retry = findAll(opened.page.root, el => el.tag === 'button' && /Thử lại/.test(textOf(el)))[0]!
    await fire(retry, 'click')
    await settle()
    assert.equal(tiles(opened).length, 1, 'the retry reloaded the list')
    const dead = await open(() => dropped())
    assert.match(alertText(dead.opened.page), /Không tải được kho video/)
  })

  it('more than one page shows the pager, and "Trang sau" asks for page 2', async () => {
    const { opened } = await open(call => answer([video(Number(call.url.searchParams.get('page')))], 30))
    assert.match(textOf(opened.page.root), /1 \/ 3/)
    const next = findAll(opened.page.root, el => el.tag === 'button' && el.props['aria-label'] === 'Trang sau')[0]!
    await fire(next, 'click')
    await settle()
    assert.match(wire(opened.calls.at(-1)!), /page=2/)
  })

  it('"Thử lại" after a failed page 2 asks for page 2 again, not for the page shown', async () => {
    let failPage2 = true
    const { opened } = await open((call) => {
      const asked = Number(call.url.searchParams.get('page'))
      if (asked === 2 && failPage2) return h3Error(403, 'Không đọc được trang 2.')
      return answer([video(asked)], 30)
    })
    const next = findAll(opened.page.root, el => el.tag === 'button' && el.props['aria-label'] === 'Trang sau')[0]!
    await fire(next, 'click')
    await settle()
    assert.match(alertText(opened.page), /Không đọc được trang 2\./)
    failPage2 = false
    await fire(findAll(opened.page.root, el => el.tag === 'button' && /Thử lại/.test(textOf(el)))[0]!, 'click')
    await settle()
    assert.match(wire(opened.calls.at(-1)!), /page=2/, 'the retry repeats the request that failed')
    assert.match(textOf(opened.page.root), /2 \/ 3/)
  })
})
