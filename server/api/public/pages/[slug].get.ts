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

/** Thông tin trang đi kèm phần block. */
interface PublicPageMeta {
  slug: string
  title: string
  seoTitle: string | null
  seoDescription: string | null
}

/**
 * Hợp đồng của endpoint này — **một** hình dạng cho cả ba nhánh `return`.
 *
 * Trước đây ba nhánh trả ba hình dạng khác nhau (`{ok:false}` /
 * `{ok,page,blocks:PublicBlockNode[]}` / `{ok,page,blocks:<hàng phẳng>}`), nên
 * `$fetch` suy ra một **union**. Union đó không thu hẹp được bằng `data.value?.ok`
 * vì `ok` suy về `boolean` chứ không phải literal, nên `data.value.page` báo
 * "Property 'page' does not exist" ở **cả bốn** trang dựng bằng block (`/`,
 * `/about`, `/contact`, `[slug]`) — 9 trong số các lỗi mà lượt bật `lang="ts"`
 * làm lộ ra.
 *
 * Cách sửa là **bỏ union đi**, không phải thêm một literal để thu hẹp nó: `page`
 * và `blocks` nay có mặt ở **mọi** nhánh (`null` và `[]` khi thất bại, chứ không
 * vắng mặt). Đó cũng là hình dạng mà bốn trang **vốn đã** giả định — cả bốn đều
 * viết `data.value?.page || null` và truyền một `default` là
 * `{ ok:false, page:null, blocks:[] }`, tức **hình dạng thứ tư** không khớp bất
 * kỳ nhánh nào của máy chủ. Một hình dạng duy nhất làm nhánh dự phòng và nhánh
 * thật đọc giống nhau: mã chạy đúng với dữ liệu mặc định cũng chạy đúng với dữ
 * liệu thật.
 *
 * `displayOrder` **không** nằm trong `PublicBlockNode`, và nhánh legacy nay cắt
 * nó bỏ: đã kiểm không nơi nào phía client đọc trường đó (chỉ trình dựng trang
 * trong `/admin` dùng), còn thứ tự thì đã nằm trong thứ tự mảng — `ORDER BY` vẫn
 * giữ nguyên.
 */
interface PublicPageResponse {
  ok: boolean
  page: PublicPageMeta | null
  blocks: PublicBlockNode[]
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

/**
 * Nhánh thất bại — cùng hình dạng với nhánh thành công, chỉ khác giá trị.
 *
 * Là **hàm**, không phải hằng dùng chung: một object hằng sẽ phát đi **cùng một**
 * mảng `blocks` cho mọi request, nên một lượt `.push()` ở đâu đó làm mọi lượt trả
 * về sau đó mang theo rác của lượt trước.
 */
function notFound(): PublicPageResponse {
  return { ok: false, page: null, blocks: [] }
}

// Public, unauthenticated, read-only. Returns only VISIBLE blocks/nodes.
// Prefers the published node tree (pages.published_blocks) when present; falls
// back to the flat page_blocks table for legacy pages (published_blocks = null).
// Unknown slug → { ok: false } with 2xx (never a 500) so the page can degrade gracefully.
export default defineEventHandler(async (event): Promise<PublicPageResponse> => {
  const slug = String(getRouterParam(event, 'slug') || '').trim()
  if (!slug) return notFound()

  try {
    const db = getDb()
    const [page] = await db.select().from(pages).where(eq(pages.slug, slug)).limit(1)
    if (!page) return notFound()

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
    // `displayOrder` is read for the ORDER BY but deliberately NOT returned: no
    // client code reads it (only the admin builder does), and the order it
    // encodes is already carried by the array order.
    const rows = await db
      .select({
        id: pageBlocks.id,
        blockType: pageBlocks.blockType,
        displayOrder: pageBlocks.displayOrder,
        data: pageBlocks.data,
      })
      .from(pageBlocks)
      .where(and(eq(pageBlocks.pageId, page.id), eq(pageBlocks.isVisible, true)))
      .orderBy(asc(pageBlocks.displayOrder), asc(pageBlocks.id))

    const blocks: PublicBlockNode[] = rows.map(row => ({
      id: row.id,
      blockType: row.blockType,
      data: row.data ?? {},
    }))

    return { ok: true, page: pageMeta, blocks }
  } catch (err) {
    logError({ event: 'public.page_render_failed', slug, error: err })
    return notFound()
  }
})
