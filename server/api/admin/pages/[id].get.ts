import { getDb } from '../../../utils/db'
import { pages, pageBlocks } from '../../../db/schema'
import { checkPermission } from '../../../utils/auth'
import { eq, asc } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  if (!checkPermission(adminUser.permissions, 'pages', 'read', adminUser.isSuperAdmin)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid page ID' })

  const db = getDb()
  const [page] = await db.select().from(pages).where(eq(pages.id, id)).limit(1)
  if (!page) {
    throw createError({ statusCode: 404, statusMessage: 'Trang không tồn tại.' })
  }

  // Live published baseline. Prefer the node tree in published_blocks (tree
  // pages); fall back to the flat page_blocks rows (legacy flat pages).
  const publishedTree = (page as any).publishedBlocks
  let blocks: any[]
  let tree = false
  if (Array.isArray(publishedTree) && publishedTree.length) {
    blocks = publishedTree
    tree = true
  } else {
    blocks = await db
      .select()
      .from(pageBlocks)
      .where(eq(pageBlocks.pageId, id))
      .orderBy(asc(pageBlocks.displayOrder), asc(pageBlocks.id))
  }

  // Pending unpublished draft, if any (MySQL JSON comes back parsed via drizzle).
  let draft: any = null
  const rawDraft = (page as any).draftBlocks
  if (Array.isArray(rawDraft)) {
    draft = { blocks: rawDraft, updatedAt: (page as any).draftUpdatedAt || null }
  }

  return { ok: true, page, blocks, draft, tree }
})
