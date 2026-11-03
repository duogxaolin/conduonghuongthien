/**
 * The categories of a flat list (`/api/admin/categories`, `/api/public/categories` — ordered
 * by `display_order`, then id) put in TREE order for a `<select>`: each root followed at once
 * by its own children. Read flat, a child sorts wherever its `display_order` puts it, so
 * "↳ tin trong ngày" showed up above its parent "Tin nổi bật" in the article editor's
 * "Danh mục" select — and, unindented, in the page builder's category field.
 *
 * Order within roots, and within one root's children, stays the server's. A category not
 * reached from a root in the list — its parent has another `type` (the server does not require
 * the same one) or is filtered out, or is itself a child (never written: the server refuses a
 * child as a parent) — is kept, at the end, in the server's order, at depth 0: listed under the
 * last root it would read as that root's child.
 *
 * Pure; tests/category-tree-order.test.ts, and the two selects mounted in
 * tests/admin-article-editor.test.ts and tests/admin-category-select-order.test.ts.
 */
export interface CategoryTreeInput {
  id: number
  parentId: number | null
}

export type CategoryTreeEntry<T extends CategoryTreeInput> = T & { depth: 0 | 1 }

export function orderCategoriesAsTree<T extends CategoryTreeInput>(items: readonly T[]): CategoryTreeEntry<T>[] {
  const ordered: CategoryTreeEntry<T>[] = []
  const placed = new Set<T>()
  for (const root of items) {
    if (root.parentId != null) continue
    ordered.push({ ...root, depth: 0 })
    placed.add(root)
    for (const child of items) {
      if (child.parentId === root.id && child !== root) {
        ordered.push({ ...child, depth: 1 })
        placed.add(child)
      }
    }
  }
  for (const rest of items) {
    if (!placed.has(rest)) ordered.push({ ...rest, depth: 0 })
  }
  return ordered
}
