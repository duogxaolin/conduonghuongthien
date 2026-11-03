/**
 * `orderCategoriesAsTree` (app/utils/category-tree-order.ts): a flat category list, as the two
 * category endpoints send it (display_order, then id), put in tree order for a `<select>` —
 * each root followed by its own children. Before it, the article editor's "Danh mục" listed
 * "↳ tin trong ngày" above its parent "Tin nổi bật" (the child's display_order was lower).
 * The selects that use it are mounted in tests/admin-article-editor.test.ts and
 * tests/admin-category-select-order.test.ts.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { orderCategoriesAsTree } from '../app/utils/category-tree-order.ts'

const cat = (id: number, parentId: number | null, name = `c${id}`) => ({ id, parentId, name })
const view = (list: ReturnType<typeof orderCategoriesAsTree<ReturnType<typeof cat>>>) => list.map(c => `${'-'.repeat(c.depth)}${c.id}`)

describe('orderCategoriesAsTree', () => {
  it('a child that arrives before its parent comes right after it', () => {
    // The user's case: "tin trong ngày" (display_order 0) is a child of "Tin nổi bật" (display_order 1).
    const flat = [cat(31, 30, 'tin trong ngày'), cat(30, null, 'Tin nổi bật')]
    assert.deepEqual(orderCategoriesAsTree(flat).map(c => [c.name, c.depth]), [['Tin nổi bật', 0], ['tin trong ngày', 1]])
  })

  it('roots keep the server order, and so do the children of one root; children never stray to another root', () => {
    const flat = [cat(5, 2), cat(1, null), cat(6, 1), cat(2, null), cat(7, 2), cat(3, null), cat(8, 1)]
    assert.deepEqual(view(orderCategoriesAsTree(flat)), ['1', '-6', '-8', '2', '-5', '-7', '3'])
  })

  it('a child whose parent is not in the list is kept, at the end, at depth 0 (not under the last root)', () => {
    const flat = [cat(9, 99), cat(1, null), cat(2, 1), cat(4, 77)]
    assert.deepEqual(view(orderCategoriesAsTree(flat)), ['1', '-2', '9', '4'])
  })

  it('a child of a child (never written by the server) is kept too, after the tree', () => {
    const flat = [cat(3, 2), cat(1, null), cat(2, 1)]
    assert.deepEqual(view(orderCategoriesAsTree(flat)), ['1', '-2', '3'])
  })

  it('nothing is lost or repeated; the input is not changed; the other fields ride along', () => {
    const flat = [cat(4, 1), cat(1, null), cat(2, null), cat(3, 2), cat(5, 42), { id: 6, parentId: 6, name: 'tự trỏ' }]
    const before = structuredClone(flat)
    const ordered = orderCategoriesAsTree(flat)
    assert.deepEqual(ordered.map(c => c.id).sort(), [1, 2, 3, 4, 5, 6])
    assert.deepEqual(flat, before)
    assert.equal(ordered.find(c => c.id === 6)?.name, 'tự trỏ')
    assert.equal(ordered.find(c => c.id === 6)?.depth, 0)
    assert.deepEqual(orderCategoriesAsTree([]), [])
  })
})
