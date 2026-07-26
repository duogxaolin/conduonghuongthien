import { isValidBlockType, isContainerType, clampColSpan } from '../../app/utils/blocks/registry'
import { sanitizeBlockData } from './sanitize-html'

// Guard against pathological / malicious nesting from the client. Section → Row →
// Column → Element is depth 4; a small buffer above that is plenty.
const MAX_TREE_DEPTH = 6

// Version quotas per page (total 10 = 1 origin + 5 auto + 4 manual).
export const VERSION_LIMITS = {
  origin: 1,
  auto: 5,
  manual: 4,
} as const

export type VersionKind = keyof typeof VERSION_LIMITS

// A block as stored in a draft/version snapshot. Draft blocks may carry a
// temporary string id (tmp_*) for blocks not yet persisted to page_blocks.
// Layout container nodes (section/row/column) additionally carry `children`
// (nested nodes) and, for columns, `colSpan` (1–12). A legacy flat block array
// is simply a list of root nodes with neither field — still valid.
export interface SnapshotBlock {
  id?: number | string
  blockType: string
  displayOrder: number
  data: Record<string, any>
  isVisible: boolean
  colSpan?: number
  children?: SnapshotBlock[]
}

// Validate + normalize an incoming node array (from client draft or a version
// snapshot). Recurses through container `children`, preserving per-container
// order (each level re-sequenced from 1, NOT globally flattened), validating
// each node's type, carrying `colSpan` (clamped 1–12 for columns) and
// recursively-normalized `children` for containers. Invalid-typed nodes are
// dropped along with their whole subtree. A legacy flat array normalizes to a
// list of childless root nodes — identical output shape as before.
export function normalizeBlocks(input: unknown, depth = 0): SnapshotBlock[] {
  if (!Array.isArray(input)) return []
  if (depth >= MAX_TREE_DEPTH) return []
  const out: SnapshotBlock[] = []
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue
    const b = raw as Record<string, any>
    const blockType = String(b.blockType || '').trim()
    if (!isValidBlockType(blockType)) continue
    // Rich-text fields inside block data are rendered with v-html on the public
    // site — sanitize here so every write path (draft save, publish, version
    // restore) stores safe markup.
    const data = sanitizeBlockData(b.data && typeof b.data === 'object' ? b.data : {}) as Record<string, any>
    const node: SnapshotBlock = {
      id: typeof b.id === 'number' || typeof b.id === 'string' ? b.id : undefined,
      blockType,
      displayOrder: out.length + 1,
      data,
      isVisible: b.isVisible === undefined ? true : !!b.isVisible,
    }
    if (isContainerType(blockType)) {
      // Columns carry an explicit span; other containers do not.
      if (blockType === 'column') node.colSpan = clampColSpan(b.colSpan)
      node.children = normalizeBlocks(b.children, depth + 1)
    }
    out.push(node)
  }
  return out
}
