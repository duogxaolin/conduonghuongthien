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

  const blocks = await db
    .select()
    .from(pageBlocks)
    .where(eq(pageBlocks.pageId, id))
    .orderBy(asc(pageBlocks.displayOrder), asc(pageBlocks.id))

  return { ok: true, page, blocks }
})
