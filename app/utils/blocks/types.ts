// ─── Page builder node types ─────────────────────────────────────────────────
// The shape that travels: builder UI → draft/publish API → MySQL JSON columns →
// PageRenderer. It was previously redeclared as `any` at every one of those
// hops, so a change at one end could not be caught at the other.

/**
 * Editor-supplied field values for one block, keyed by the `key` of the block's
 * registry field. Deliberately open: each block type defines its own fields at
 * runtime, and `unknown` here would force a cast at every template read without
 * buying any safety the registry does not already provide.
 */
export type BlockData = Record<string, any>

/**
 * One node of a page's block tree.
 *
 * `id` is numeric for persisted blocks and a temporary `tmp_*` string for
 * blocks the editor has added but not yet saved. Layout containers
 * (section / row / column) carry `children`; only `column` carries `colSpan`,
 * a 1–12 span of the row grid. A legacy flat page is just a list of root nodes
 * with neither field, which stays valid under this type.
 */
export interface BlockNode {
  id?: number | string
  blockType: string
  displayOrder: number
  data: BlockData
  isVisible: boolean
  colSpan?: number
  children?: BlockNode[]
}

/**
 * A node as the builder holds it in memory. Identical to a BlockNode except
 * that `displayOrder` is assigned when the tree is serialised for save, so an
 * in-flight node does not carry one yet — which also applies to its children,
 * hence the recursive override rather than inheriting `children: BlockNode[]`.
 */
export type BuilderNode = Omit<BlockNode, 'displayOrder' | 'children'> & {
  displayOrder?: number
  children?: BuilderNode[]
}

/** Where a node sits in the tree: its sibling array, its index, its parent. */
export interface NodeLocation {
  siblings: BuilderNode[]
  index: number
  parent: BuilderNode | null
}
