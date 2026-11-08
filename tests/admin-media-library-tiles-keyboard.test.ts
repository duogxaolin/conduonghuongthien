/**
 * The image library's tiles (`components/admin/MediaLibraryModal.vue`) are buttons: Tab reaches them and
 * Enter/Space choose one (a native `<button type="button">` turns both keys into `click`). They were `<div>`s
 * with a click handler — a mouse-only list, in the dialog the editor's image browse button opens. A tile's
 * name is its image's alt (the visible file name under it is hidden from assistive tech, not read twice);
 * when several images are being picked, `aria-pressed` says which are in the selection. No other control
 * sits inside a tile, so the button nests nothing.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import * as Vue from 'vue'

import { fire, findAll, type MiniElement } from './_sfc-mount.ts'
import { json, mountAdminPage, OpenModal, routes, settle, unmountAll } from './_admin-page-harness.ts'

afterEach(unmountAll)

const LIST = '/api/admin/media'
const image = (id: number, name: string) => ({ id, filename: `${name}.webp`, originalName: `${name}.jpg`, mimeType: 'image/webp', sizeBytes: 10, provider: 'local', url: `/uploads/${name}.webp`, width: 10, height: 10, createdAt: null, uploadedBy: 1 })

async function openLibrary(multiple: boolean) {
  const isOpen = Vue.ref(false)
  const chosen: unknown[] = []
  const picker = {
    isOpen, isMultiple: Vue.ref(multiple), closePicker: () => { isOpen.value = false },
    handleSelect: (item: unknown) => { chosen.push(item) }, handleSelectMultiple: () => {},
  }
  const uploader = { uploading: Vue.ref(false), uploadBatch: async () => [], tasks: Vue.ref([]), uploadingBatch: Vue.ref(false) }
  const opened = await mountAdminPage('components/admin/MediaLibraryModal.vue', routes({
    [`GET ${LIST}`]: () => json({ ok: true, items: [image(1, 'anh-mot'), image(2, 'anh-hai')], pagination: { page: 1, perPage: 20, total: 2, totalPages: 1 } }),
  }), {
    modules: { '~/components/admin/AdminModal.vue': { default: OpenModal } },
    auto: { useImagePicker: () => picker, useUpload: () => uploader },
  })
  isOpen.value = true
  await settle()
  return { opened, chosen }
}

/** The tile whose image has this alt: the nearest element above the `<img>` with a click handler. */
function tileOf(root: MiniElement, alt: string): MiniElement {
  const img = findAll(root, el => el.tag === 'img' && el.props.alt === alt)[0]
  assert.ok(img, `an image named ${alt}`)
  let el: MiniElement | null = img.parent
  while (el && !el.props.onClick) el = el.parent
  assert.ok(el, `a clickable tile around ${alt}`)
  return el
}

describe('image library tiles — reachable and usable from the keyboard', () => {
  it('every tile is a type="button" button named by its image, the file name not read twice', async () => {
    const { opened } = await openLibrary(false)
    for (const alt of ['anh-mot.jpg', 'anh-hai.jpg']) {
      const tile = tileOf(opened.page.root, alt)
      assert.equal(tile.tag, 'button')
      assert.equal(tile.props.type, 'button')
      assert.match(String(tile.props.class), /focus-visible:outline-brand-600/)
      const caption = findAll(tile, el => el.tag === 'span' && el.props['aria-hidden'] === 'true' && /truncate/.test(String(el.props.class)))
      assert.equal(caption.length, 1, 'the visible file name is hidden from assistive tech')
    }
    // The default images on top of the library are tiles too.
    const tiles = findAll(opened.page.root, el => el.tag === 'button' && findAll(el, img => img.tag === 'img').length === 1)
    assert.ok(tiles.length > 2, 'default images and uploaded ones are all buttons')
    assert.equal(findAll(opened.page.root, el => el.tag === 'div' && /cursor-pointer/.test(String(el.props.class))).length, 0, 'no clickable div left')
  })

  it('choosing one image: activating the tile chooses it (no aria-pressed — it is not a toggle)', async () => {
    const { opened, chosen } = await openLibrary(false)
    const tile = tileOf(opened.page.root, 'anh-hai.jpg')
    assert.equal(tile.props['aria-pressed'], undefined)
    await fire(tile, 'click')
    assert.deepEqual((chosen as Array<{ id: number }>).map(item => item.id), [2])
  })

  it('picking several: aria-pressed follows the selection', async () => {
    const { opened } = await openLibrary(true)
    assert.equal(tileOf(opened.page.root, 'anh-mot.jpg').props['aria-pressed'], false)
    await fire(tileOf(opened.page.root, 'anh-mot.jpg'), 'click')
    await settle()
    assert.equal(tileOf(opened.page.root, 'anh-mot.jpg').props['aria-pressed'], true)
    assert.equal(tileOf(opened.page.root, 'anh-hai.jpg').props['aria-pressed'], false)
  })
})
