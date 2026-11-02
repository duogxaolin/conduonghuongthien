/**
 * The desktop table of the articles list (`pages/admin/content/articles/index.vue`) is wider
 * than its card at every admin width — measured in Chromium on the real page and Tailwind build:
 * 1309 px of table in a 1130 px card at 1440, 970 at 1280, 714 at 1024 — so the "Thao tác"
 * column started past the right edge of the scroll area and an officer saw no Sửa / Dịch / Tải /
 * Xóa until scrolling the table sideways (its scrollbar sits under 15 tall rows). The column is
 * now pinned to the right edge of the scrolling table (`sticky right-0`), opaque so the cells
 * scrolling under it do not show through, keeping the row's tint (hover, ticked), and its four
 * actions sit in a 2 × 2 grid instead of a one-per-line stack.
 *
 * A sticky cell is a stacking context: the "Dịch"/"Tải" menu of one row (z-30 INSIDE its cell)
 * was painted under the next row's sticky cell, so the cell of the row whose menu is open is
 * raised (`z-20`) — measured: without it the next row's cell covers the menu.
 *
 * No browser here: this pins the classes the measurement depends on, on the mounted page.
 * Before/after measurements and screenshots: the proof folder of this change (CHANGELOG § 70).
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import * as Vue from 'vue'

import { click, findAll, fire, textOf, type MiniElement } from './_sfc-mount.ts'
import { json, mountAdminPage, routes, settle, unmountAll, type MountedAdminPage } from './_admin-page-harness.ts'

const LIST = 'pages/admin/content/articles/index.vue'
const article = (id: number) => ({
  id, type: 'news', category: null, categoryId: null, categoryName: null, categoryParentId: null, parentCategoryName: null,
  title: `Bài ${id}`, slug: `bai-${id}`, excerpt: null, status: 'published', thumbnailUrl: null, commentsEnabled: false,
  publishedAt: null, createdAt: '2026-10-20T02:00:00.000Z', updatedAt: null, authorName: 'bientap', viewTotal: 12, translatedLangs: '',
})
const passthrough = (name: string) => ({ default: Vue.defineComponent({ name, setup: () => () => Vue.h('div', { 'data-stub': name }) }) })
const open = () => mountAdminPage(LIST, routes({
  'GET /api/admin/categories': () => json({ ok: true, items: [] }),
  'GET /api/admin/articles/authors': () => json({ ok: true, items: [], orphanCount: 0 }),
  'GET /api/admin/content-types': () => json({ ok: true, items: [{ id: 1, slug: 'news', name: 'Bản tin', isSystem: true }] }),
  'GET /api/admin/articles': () => json({ ok: true, items: [article(3), article(4), article(5)], pagination: { page: 1, perPage: 15, total: 3, totalPages: 1 } }),
  'GET /api/admin/articles/bulk-translate-status': () => json({ ok: true, active: false, dbTranslatingCount: 0, task: { active: false, total: 0, processed: 0, currentArticleId: null, currentArticleTitle: null, langCode: '', langName: '', startedAt: null, completedAt: null } }),
  'GET /api/admin/articles/translation-stats': () => json({ ok: true, totalArticles: 3, languages: [], aiPendingTranslations: 0 }),
}), {
  modules: Object.fromEntries(['ArticleQuickViewModal', 'ArticleGlobalTranslateModal', 'ArticleBoostStatsPanel', 'ArticleBulkTranslateBanner', 'ScanThumbnailsModal']
    .map(name => [`~/components/admin/articles/${name}.vue`, passthrough(name)])),
})

const classes = (el: MiniElement) => String(el.props.class ?? '').split(/\s+/).filter(Boolean)
const table = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'table')[0]!
const rows = (opened: MountedAdminPage) => findAll(table(opened), el => el.tag === 'tbody')[0]!.children.filter((r): r is MiniElement => r.kind === 'element')
const actionCell = (row: MiniElement) => row.children.filter((c): c is MiniElement => c.kind === 'element' && c.tag === 'td').at(-1)!
const actionsTh = (opened: MountedAdminPage) => findAll(table(opened), el => el.tag === 'th').at(-1)!
const rowButton = (row: MiniElement, label: string) => findAll(actionCell(row), el => el.tag === 'button' && textOf(el) === label)[0]!

describe('articles table — the "Thao tác" column stays on screen', () => {
  afterEach(() => unmountAll())

  it('the header and every row\'s action cell are pinned to the right edge of the scrolling table', async () => {
    const opened = await open()
    await settle()
    assert.equal(textOf(actionsTh(opened)), 'Thao tác')
    for (const cls of ['sticky', 'right-0', 'bg-surface']) assert.ok(classes(actionsTh(opened)).includes(cls), `th lacks ${cls}`)
    // The table scrolls inside its own box, not the page.
    assert.ok(classes(table(opened).parent!).includes('overflow-x-auto'))
    assert.equal(rows(opened).length, 3)
    for (const row of rows(opened)) {
      const cell = actionCell(row)
      for (const cls of ['sticky', 'right-0', 'bg-white', 'group-hover:bg-surface']) assert.ok(classes(cell).includes(cls), `action cell lacks ${cls}: ${cell.props.class}`)
      assert.ok(!classes(cell).includes('z-20'), 'no menu open, no raised cell')
      const actions = findAll(cell, el => el.tag === 'div')[0]!
      assert.deepEqual(['grid', 'grid-cols-[auto_auto]', 'whitespace-nowrap'].filter(c => !classes(actions).includes(c)), [])
      assert.ok(!classes(actions).includes('flex-wrap'), 'one action per line made every row ~150 px tall')
      assert.deepEqual(findAll(actions, el => el.tag === 'button' || el.tag === 'nuxt-link').map(textOf).filter(t => /^(Sửa|Dịch|Tải|Xóa)$/.test(t)), ['Sửa', 'Dịch', 'Tải', 'Xóa'])
    }
  })

  it('a ticked row keeps its tint under the pinned cell (opaque white would hide it)', async () => {
    const opened = await open()
    await settle()
    const second = rows(opened)[1]!
    await fire(findAll(second, el => el.tag === 'input' && el.props.type === 'checkbox')[0]!, 'change')
    await settle()
    assert.ok(classes(actionCell(rows(opened)[1]!)).includes('bg-surface-tint'))
    assert.ok(!classes(actionCell(rows(opened)[1]!)).includes('bg-white'))
    assert.ok(classes(actionCell(rows(opened)[0]!)).includes('bg-white'))
  })

  it('the row whose "Tải" or "Dịch" menu is open is raised above the next rows\' pinned cells; closing it lowers it again', async () => {
    const opened = await open()
    await settle()
    await click(rowButton(rows(opened)[0]!, 'Tải'))
    await settle()
    assert.deepEqual(rows(opened).map(r => classes(actionCell(r)).includes('z-20')), [true, false, false])
    await click(rowButton(rows(opened)[0]!, 'Tải'))
    await settle()
    assert.deepEqual(rows(opened).map(r => classes(actionCell(r)).includes('z-20')), [false, false, false])
    await click(rowButton(rows(opened)[1]!, 'Dịch'))
    await settle()
    assert.deepEqual(rows(opened).map(r => classes(actionCell(r)).includes('z-20')), [false, true, false])
  })
})
