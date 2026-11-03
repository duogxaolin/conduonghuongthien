import { computed, ref, type Ref } from 'vue'

// Relative paths, not `~/`: tests import this file directly, and the test loader
// (scripts/ts-resolver.mjs) only knows `~~/`.
import { BLOCK_REGISTRY, blocksByCategory } from '../utils/blocks/registry'
import { cloneSubtree, findNode, locateNode, makeNode } from '../utils/blocks/builder-tree'
import type { BuilderNode, NodeId } from '../utils/blocks/types'
import type { useConfirm } from './useConfirm'
import type { useToast } from './useToast'

/**
 * Edits of the page builder's working tree (`pages/admin/content/pages/[id].vue`): add a block
 * from the palette (at the root or into a container, filtered by what that container takes),
 * duplicate, show/hide, delete, move among siblings. All local — the page saves the working
 * copy as a draft (`scheduleDraftSave`, handed in) and publishes it. Moved out of the page when
 * it was split (wave3 4.2), unchanged.
 *
 * `toast`/`confirm` are the page's own, handed in, so this file needs no Nuxt auto-import and
 * runs as is under the tests.
 */
export interface BuilderTreeEditsDeps {
  toast: Pick<ReturnType<typeof useToast>, 'success'>
  confirm: ReturnType<typeof useConfirm>['confirm']
  /** The working copy. */
  blocks: Ref<BuilderNode[]>
  selectedId: Ref<number | string | null>
  /** The page's counter of temporary ids (`createTmpIds`). */
  nextTmpId: () => string
  /** Debounced draft save of the whole working copy. */
  scheduleDraftSave: () => void
}

/** Một mục trong bảng chọn khối — đúng phần tử `blocksByCategory()` sinh ra, nên
 *  thêm block mới vào registry là kiểu này tự theo. */
export type PaletteItem = ReturnType<typeof blocksByCategory>['section'][number]
export type PaletteGroup = { key: string; title: string; items: PaletteItem[] }

export function useBuilderTreeEdits({ toast, confirm, blocks, selectedId, nextTmpId, scheduleDraftSave }: BuilderTreeEditsDeps) {
  const registry = BLOCK_REGISTRY
  const grouped = blocksByCategory()

  // ── Palette / add (local only; persisted to draft) ──
  // `paletteParentId` = the container the palette is adding INTO (null = root).
  const showPalette = ref(false)
  const adding = ref(false)
  const paletteParentId = ref<NodeId>(null)

  // Open the add-palette targeting a specific parent container (from the tree's
  // "+" affordance), or at root level when no parent is given.
  const openPalette = (parentId: NodeId = null) => {
    paletteParentId.value = parentId ?? null
    showPalette.value = true
  }

  // Which block groups the palette offers, filtered by the parent context:
  //   root/section → section blocks + layout containers
  //   row          → column only
  //   column       → element (section + content) blocks only, no containers
  const paletteGroups = computed<PaletteGroup[]>(() => {
    const parent = paletteParentId.value == null ? null : findNode(paletteParentId.value, blocks.value)
    const pType = parent?.blockType
    if (pType === 'row') {
      return [{ key: 'layout', title: 'Bố cục', items: grouped.layout.filter(i => i.type === 'column') }]
    }
    if (pType === 'column') {
      return [
        { key: 'content', title: 'Khối nội dung', items: grouped.content },
        { key: 'section', title: 'Khối trang chủ', items: grouped.section },
      ]
    }
    // root or section: section blocks + layout containers (row/section)
    return [
      { key: 'layout', title: 'Bố cục', items: grouped.layout.filter(i => i.type !== 'column') },
      { key: 'section', title: 'Khối trang chủ', items: grouped.section },
      { key: 'content', title: 'Khối nội dung', items: grouped.content },
    ]
  })

  // Human-readable hint of where the new block will land.
  const paletteContextLabel = computed(() => {
    const parent = paletteParentId.value == null ? null : findNode(paletteParentId.value, blocks.value)
    if (!parent) return 'Thêm vào cấp gốc của trang.'
    const label = registry[parent.blockType]?.label || parent.blockType
    if (parent.blockType === 'row') return `Thêm Cột vào ${label}.`
    if (parent.blockType === 'column') return `Thêm nội dung vào ${label}.`
    return `Thêm vào ${label}.`
  })

  const addBlock = (type: string) => {
    const node = makeNode(type, nextTmpId)
    const parentId = paletteParentId.value
    if (parentId == null) {
      // Root: insert after the selected root node (if any), else append.
      const loc = selectedId.value != null ? locateNode(selectedId.value, blocks.value) : null
      if (loc && loc.parent === null) blocks.value.splice(loc.index + 1, 0, node)
      else blocks.value.push(node)
    } else {
      const parent = findNode(parentId, blocks.value)
      if (parent) {
        if (!Array.isArray(parent.children)) parent.children = []
        parent.children.push(node)
      } else {
        blocks.value.push(node)
      }
    }
    selectedId.value = node.id ?? null
    showPalette.value = false
    paletteParentId.value = null
    scheduleDraftSave()
    toast.success('Đã thêm block. Nhớ bấm Xuất bản để đưa lên site.')
  }

  // ── Duplicate (local only) — deep-clones the node and its whole subtree ──
  const duplicateBlock = (block: BuilderNode) => {
    const loc = locateNode(block.id, blocks.value)
    if (!loc) return
    const copy = cloneSubtree(block, nextTmpId)
    loc.siblings.splice(loc.index + 1, 0, copy)
    selectedId.value = copy.id ?? null
    scheduleDraftSave()
    toast.success('Đã nhân đôi block.')
  }

  // ── Visibility (local) ──
  const toggleVisible = (block: BuilderNode) => {
    block.isVisible = !block.isVisible
    scheduleDraftSave()
  }

  // ── Delete (local) — removes the node (and its subtree) from its own parent ──
  const removeBlock = async (block: BuilderNode) => {
    const ok = await confirm({ title: 'Xóa block', message: `Xóa block "${registry[block.blockType]?.label || block.blockType}"?`, danger: true, confirmLabel: 'Xóa' })
    if (!ok) return
    const loc = locateNode(block.id, blocks.value)
    if (!loc) return
    loc.siblings.splice(loc.index, 1)
    if (selectedId.value === block.id) {
      // Prefer a remaining sibling, else the parent, else the first root node.
      const sib = loc.siblings[loc.index] ?? loc.siblings[loc.index - 1]
      selectedId.value = sib?.id ?? loc.parent?.id ?? blocks.value[0]?.id ?? null
    }
    scheduleDraftSave()
    toast.success('Đã xóa block khỏi bản nháp.')
  }

  // ── Reorder (arrows in canvas / property panel) — within the node's own siblings ──
  // `index` is the node's index among its siblings; move swaps within that array so
  // nesting is preserved.
  const move = (index: number, dir: number) => {
    if (selectedId.value == null) return
    const loc = locateNode(selectedId.value, blocks.value)
    if (!loc) return
    const arr = loc.siblings
    const from = loc.index
    const target = from + dir
    if (target < 0 || target >= arr.length) return
    const a = arr[from]
    const b = arr[target]
    if (a === undefined || b === undefined) return
    arr[from] = b
    arr[target] = a
    scheduleDraftSave()
  }

  return {
    showPalette, adding, openPalette, paletteGroups, paletteContextLabel, addBlock,
    duplicateBlock, toggleVisible, removeBlock, move,
  }
}
