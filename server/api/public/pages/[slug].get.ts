import { getDb } from '../../../utils/db'
import { logError } from '../../../utils/logger'
import { pages, pageBlocks } from '../../../db/schema'
import { and, eq, asc } from 'drizzle-orm'
import type { BlockData, BlockNode } from '../../../../app/utils/blocks/types'

/**
 * Một node đã lọc để phát ra công khai.
 *
 * KHÔNG phải `BlockNode`: cờ `isVisible` bị **cắt bỏ** ở đây có chủ đích — phần
 * tải công khai chỉ chứa node đang hiện, nên gửi kèm một cờ luôn bằng `true` là
 * mời mã phía client đi kiểm lại một điều đã được quyết định ở máy chủ. Khai
 * đúng hình dạng thật (thay cho `any[]`) để một lần đổi projection sau này
 * không âm thầm thêm lại một trường chỉ dùng cho trình dựng trang.
 */
interface PublicBlockNode {
  id?: number | string
  blockType: string
  data: BlockData
  colSpan?: number
  children?: PublicBlockNode[]
}

// Recursively drop any node with isVisible === false (and its whole subtree),
// and strip the isVisible flag from the returned tree (public payload = visible
// nodes only). Preserves colSpan and recurses into container children.
function pruneHiddenTree(nodes: unknown): PublicBlockNode[] {
  if (!Array.isArray(nodes)) return []
  const out: PublicBlockNode[] = []
  for (const item of nodes) {
    if (!item || typeof item !== 'object') continue
    const n = item as Partial<BlockNode>
    if (n.isVisible === false) continue
    const node: PublicBlockNode = {
      id: n.id,
      blockType: String(n.blockType ?? ''),
      data: n.data || {},
    }
    if (typeof n.colSpan === 'number') node.colSpan = n.colSpan
    if (Array.isArray(n.children)) node.children = pruneHiddenTree(n.children)
    out.push(node)
  }
  return out
}

// Public, unauthenticated, read-only. Returns only VISIBLE blocks/nodes.
// Prefers the published node tree (pages.published_blocks) when present; falls
// back to the flat page_blocks table for legacy pages (published_blocks = null).
// Unknown slug → { ok: false } with 2xx (never a 500) so the page can degrade gracefully.
export default defineEventHandler(async (event) => {
  const slug = String(getRouterParam(event, 'slug') || '').trim()
  if (!slug) return { ok: false }

  try {
    const db = getDb()
    const [page] = await db.select().from(pages).where(eq(pages.slug, slug)).limit(1)
    if (!page) return { ok: false }

    const pageMeta = {
      slug: page.slug,
      title: page.title,
      seoTitle: page.seoTitle,
      seoDescription: page.seoDescription,
    }

    // Prefer the published tree when it is a non-empty array.
    const tree = page.publishedBlocks
    if (Array.isArray(tree) && tree.length) {
      return { ok: true, page: pageMeta, blocks: pruneHiddenTree(tree) }
    }

    // Legacy fallback: flat visible rows from page_blocks.
    const blocks = await db
      .select({
        id: pageBlocks.id,
        blockType: pageBlocks.blockType,
        displayOrder: pageBlocks.displayOrder,
        data: pageBlocks.data,
      })
      .from(pageBlocks)
      .where(and(eq(pageBlocks.pageId, page.id), eq(pageBlocks.isVisible, true)))
      .orderBy(asc(pageBlocks.displayOrder), asc(pageBlocks.id))

    return { ok: true, page: pageMeta, blocks }
  } catch (err) {
    logError({ event: 'public.page_render_failed', slug, error: err })
    return { ok: false }
  }
})
