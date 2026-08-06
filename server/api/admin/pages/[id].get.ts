import type { BlockNode } from '../../../../app/utils/blocks/types'
import { getDb } from '../../../utils/db'
import { pages, pageBlocks } from '../../../db/schema'
import { eq, asc } from 'drizzle-orm'
import { requireResourcePermission } from '../../../utils/permissions'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'pages', 'read')

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid page ID' })

  const db = getDb()
  const [page] = await db.select().from(pages).where(eq(pages.id, id)).limit(1)
  if (!page) {
    throw createError({ statusCode: 404, statusMessage: 'Trang không tồn tại.' })
  }

  // Live published baseline. Prefer the node tree in published_blocks (tree
  // pages); fall back to the flat page_blocks rows (legacy flat pages).
  const publishedTree = page.publishedBlocks
  let blocks: BlockNode[]
  let tree = false
  if (Array.isArray(publishedTree) && publishedTree.length) {
    blocks = publishedTree
    tree = true
  } else {
    /**
     * `page_blocks.data` là cột JSON nullable, còn `BlockNode.data` thì không:
     * mọi nơi đọc cây block (trình dựng, renderer) đều đọc thẳng `node.data.x`.
     * Một hàng cũ có `data = NULL` sẽ làm nổ đúng ở đó, nên chuẩn hoá về `{}`
     * tại biên đọc — một lần, chứ không phải một `?? {}` ở từng nơi đọc.
     */
    const rows = await db
      .select()
      .from(pageBlocks)
      .where(eq(pageBlocks.pageId, id))
      .orderBy(asc(pageBlocks.displayOrder), asc(pageBlocks.id))
    blocks = rows.map(row => ({ ...row, data: row.data ?? {}, isVisible: row.isVisible ?? true }))
  }

  // Pending unpublished draft, if any (MySQL JSON comes back parsed via drizzle).
  //
  // Kiểu khai tường minh, không `any`: kiểu trả về của handler này chính là kiểu
  // trang quản trị đọc được (`AdminPageDetail` suy thẳng từ đây), nên một `any` ở
  // đây lan sang cả trình dựng trang — và `Serialize` của Nitro thì **nuốt hẳn**
  // trường kiểu `any`, khiến trang báo "không có thuộc tính draft" cho một trường
  // máy chủ vẫn đang trả về.
  let draft: { blocks: BlockNode[], updatedAt: Date | null } | null = null
  const rawDraft = page.draftBlocks
  if (Array.isArray(rawDraft)) {
    draft = { blocks: rawDraft, updatedAt: page.draftUpdatedAt || null }
  }

  return { ok: true, page, blocks, draft, tree }
})
