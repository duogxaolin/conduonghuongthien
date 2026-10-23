import { createError } from 'h3'
import { isValidBlockType, isContainerType, clampColSpan } from '../../app/utils/blocks/registry'
import type { BlockData, BlockNode } from '../../app/utils/blocks/types'
import { UnsafeLinkError } from '../../shared/link-policy'
import { assertSafeBlockLinks, sanitizeBlockData } from './sanitize-html'

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

// A block as stored in a draft/version snapshot is just a node of the page
// tree; the shape lives with the registry so the client and the server cannot
// drift apart. Kept exported under the old name for existing importers.
export type SnapshotBlock = BlockNode

// Validate + normalize an incoming node array (from client draft or a version
// snapshot). Recurses through container `children`, preserving per-container
// order (each level re-sequenced from 1, NOT globally flattened), validating
// each node's type, carrying `colSpan` (clamped 1–12 for columns) and
// recursively-normalized `children` for containers. Invalid-typed nodes are
// dropped along with their whole subtree. A legacy flat array normalizes to a
// list of childless root nodes — identical output shape as before.
//
// Link fields (registry `type: 'url'`, incl. `links[].url` and translations) must
// hold an allowed link (shared/link-policy.ts) — `javascript:` in a button is
// script on click for every visitor. By default an unsafe one is a 400 naming the
// field, before anything is stored: not silently blanked, so the editor sees why
// the save failed. `links: 'keep'` is for ONE caller only — publish's snapshot of
// the tree that is live right now, taken as it is so a legacy unsafe link in the
// OLD tree cannot block publishing the fix; restoring that snapshot later goes
// through the default check again.
export interface NormalizeBlocksOptions {
  links?: 'reject' | 'keep'
}

export function normalizeBlocks(input: unknown, options: NormalizeBlocksOptions = {}, depth = 0): SnapshotBlock[] {
  if (!Array.isArray(input)) return []
  if (depth >= MAX_TREE_DEPTH) return []
  const out: SnapshotBlock[] = []
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue
    const b = raw as Record<string, unknown>
    const blockType = String(b.blockType || '').trim()
    if (!isValidBlockType(blockType)) continue
    if (options.links !== 'keep') {
      try {
        assertSafeBlockLinks(blockType, b.data)
      } catch (error) {
        if (error instanceof UnsafeLinkError) {
          throw createError({ statusCode: 400, statusMessage: `${error.message} (block ${blockType})` })
        }
        throw error
      }
    }
    // Rich-text fields inside block data are rendered with v-html on the public
    // site — sanitize here so every write path (draft save, publish, version
    // restore) stores safe markup.
    const data = sanitizeBlockData(b.data && typeof b.data === 'object' ? b.data : {}) as BlockData
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
      node.children = normalizeBlocks(b.children, options, depth + 1)
    }
    out.push(node)
  }
  return out
}
