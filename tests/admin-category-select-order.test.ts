/**
 * The page builder's "Lọc theo danh mục" field (app/components/admin/builder/PropertyPanel.vue),
 * mounted for real: it lists `/api/public/categories?type=…` — a flat list by display order —
 * so a child category came before its parent, and unindented it read as a root. It now uses the
 * same tree order as the article editor's "Danh mục" (app/utils/category-tree-order.ts): each
 * parent, then its own children marked "↳"; the value is still the slug.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as Vue from 'vue'

import { settle } from './_admin-page-harness.ts'
import { findAll, input, mountSfc, textOf } from './_sfc-mount.ts'

const PANEL = new URL('../app/components/admin/builder/PropertyPanel.vue', import.meta.url).pathname
const StandIn = (name: string) => Vue.defineComponent({ name, setup: () => () => Vue.h('div', { 'data-stub': name }) })

const row = (id: number, name: string, parentId: number | null, displayOrder: number) => ({
  id, name, slug: `muc-${id}`, parentId, type: 'news', description: null, displayOrder,
})

describe('page builder — category field in tree order', () => {
  it('each parent is followed by its own children, whatever the display order; the slug is the value', async (t) => {
    const calls: unknown[] = []
    const flat = [
      row(31, 'tin trong ngày', 30, 0), row(40, 'Thông báo', null, 0), row(30, 'Tin nổi bật', null, 1),
      row(41, 'Lịch công tác', 40, 2), row(32, 'Ảnh hoạt động', 30, 3),
    ]
    const block = Vue.reactive({ id: 'b1', blockType: 'news', data: { title: 'Tin', categorySlug: '', maxItems: 5 } })
    const listeners: string[] = []
    const mounted = await mountSfc(PANEL, {
      auto: {
        $fetch: async (url: string, options: unknown) => { calls.push([url, options]); return { ok: true, items: flat } },
        useImagePicker: () => ({ openPicker: () => {} }),
        useVideoPicker: () => ({ openVideoPicker: () => {} }),
        window: { addEventListener: (type: string) => { listeners.push(type) }, removeEventListener: () => {} },
      },
      modules: {
        '~/components/admin/TinyMceEditor.vue': { default: StandIn('TinyMceEditor') },
        '~/components/admin/builder/BuilderArrayEditor.vue': { default: StandIn('BuilderArrayEditor') },
      },
    }, { block, index: 0, total: 1 })
    t.after(() => mounted.unmount())
    await settle()
    assert.deepEqual(mounted.errors, [])
    assert.deepEqual(calls, [['/api/public/categories', { params: { type: 'news' } }]])

    const select = findAll(mounted.root, el => el.tag === 'select' && findAll(el, o => o.tag === 'option' && textOf(o) === 'Tất cả').length === 1)
    assert.equal(select.length, 1)
    const options = findAll(select[0]!, el => el.tag === 'option')
    assert.deepEqual(options.map(textOf), ['Tất cả', 'Thông báo', '↳ Lịch công tác', 'Tin nổi bật', '↳ tin trong ngày', '↳ Ảnh hoạt động'])
    assert.deepEqual(options.map(o => o.props.value), ['', 'muc-40', 'muc-41', 'muc-30', 'muc-31', 'muc-32'])

    await input(select[0]!, 'muc-31')
    assert.equal(block.data.categorySlug, 'muc-31')
  })
})
