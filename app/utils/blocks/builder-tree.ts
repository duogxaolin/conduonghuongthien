// Relative paths, not `~/`: tests import this file directly, and the test loader
// (scripts/ts-resolver.mjs) only knows `~~/`.
import { clampColSpan, DEFAULT_COL_SPAN, getDefaultData, isContainerType } from './registry'
import type { BlockNode, BuilderNode, NodeId, NodeLocation } from './types'

/**
 * The page builder's working copy (`pages/admin/content/pages/[id].vue`) is a tree of nodes
 * `{ id, blockType, data, isVisible, colSpan?, children?[] }`; a legacy flat page is a list of
 * childless root nodes. These are the builder's tree walkers and shape converters, moved out
 * of the page when it was split (wave3 4.2) — unchanged, except that the tree they work on is
 * passed in (the page passed its own `blocks.value` by default).
 *
 * A node id is numeric once persisted, `tmp_*` while unsaved. Temporary ids come from a
 * counter the page owns (`createTmpIds`), handed to the functions that make nodes.
 */

/** A page's counter of temporary ids: `tmp_1`, `tmp_2`… (assigned real ids on publish). */
export function createTmpIds(): () => string {
  let tmpCounter = 1
  return () => `tmp_${tmpCounter++}`
}

/** The node with `id`, at any depth. */
export const findNode = (id: NodeId, list: BuilderNode[]): BuilderNode | null => {
  for (const n of list) {
    if (n.id === id) return n
    if (Array.isArray(n.children)) {
      const hit = findNode(id, n.children)
      if (hit) return hit
    }
  }
  return null
}

/** `{ siblings, index, parent }` for the node with `id`; parent is null at root. */
export const locateNode = (id: NodeId, list: BuilderNode[], parent: BuilderNode | null = null): NodeLocation | null => {
  const idx = list.findIndex(n => n.id === id)
  if (idx !== -1) return { siblings: list, index: idx, parent }
  for (const n of list) {
    if (Array.isArray(n.children)) {
      const hit = locateNode(id, n.children, n)
      if (hit) return hit
    }
  }
  return null
}

/**
 * The tree without ids, for the "is there anything to publish" comparison. Walks the whole
 * tree so structural edits (nesting, colSpan, order) are detected.
 */
export const strip = (arr: BuilderNode[]): BuilderNode[] => arr.map(b => {
  const o: BuilderNode = { blockType: b.blockType, isVisible: b.isVisible !== false, data: b.data || {} }
  if (b.blockType === 'column') o.colSpan = b.colSpan ?? 12
  if (Array.isArray(b.children)) o.children = strip(b.children)
  return o
})

/**
 * Normalize a loaded node tree into the working-copy shape: every node has an id (tmp for
 * unsaved), a data object, a boolean isVisible; columns carry colSpan, and containers carry a
 * (possibly empty) children array.
 */
export const hydrateNodes = (list: unknown, nextTmpId: () => string): BuilderNode[] => (Array.isArray(list) ? list : []).map((b: BuilderNode) => {
  const node: BuilderNode = {
    ...b,
    id: b.id ?? nextTmpId(),
    data: b.data || {},
    isVisible: b.isVisible === undefined ? true : !!b.isVisible,
  }
  if (b.blockType === 'column') node.colSpan = clampColSpan(b.colSpan)
  if (isContainerType(b.blockType)) node.children = hydrateNodes(b.children || [], nextTmpId)
  return node
})

/** A fresh node for `type`; containers start with an empty children array, columns with a default colSpan. */
export const makeNode = (type: string, nextTmpId: () => string) => {
  const node: BuilderNode = { id: nextTmpId(), blockType: type, data: getDefaultData(type), isVisible: true }
  if (type === 'column') node.colSpan = DEFAULT_COL_SPAN
  if (isContainerType(type)) node.children = []
  return node
}

/** A deep copy of `node` and its whole subtree, with new temporary ids. */
export const cloneSubtree = (node: BuilderNode, nextTmpId: () => string): BuilderNode => {
  const copy: BuilderNode = {
    id: nextTmpId(),
    blockType: node.blockType,
    data: JSON.parse(JSON.stringify(node.data || {})),
    isVisible: node.isVisible !== false,
  }
  if (node.blockType === 'column') copy.colSpan = clampColSpan(node.colSpan)
  if (Array.isArray(node.children)) copy.children = node.children.map(child => cloneSubtree(child, nextTmpId))
  return copy
}

/**
 * The working tree as the draft/publish/version payloads carry it. Preserves nesting
 * (children), column widths (colSpan), and per-level order.
 */
export const serializeNodes = (list: BuilderNode[]): BlockNode[] => list.map((b, i) => {
  const out: BlockNode = {
    id: typeof b.id === 'number' ? b.id : undefined,
    blockType: b.blockType,
    displayOrder: i + 1,
    data: b.data || {},
    isVisible: b.isVisible !== false,
  }
  if (b.blockType === 'column') out.colSpan = clampColSpan(b.colSpan)
  if (Array.isArray(b.children)) out.children = serializeNodes(b.children)
  return out
})
