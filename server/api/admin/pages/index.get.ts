import { getDb } from '../../../utils/db'
import { pages, pageBlocks } from '../../../db/schema'
import { checkPermission } from '../../../utils/auth'
import { asc, sql } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  if (!checkPermission(adminUser.permissions, 'pages', 'read', adminUser.isSuperAdmin)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }

  const db = getDb()

  const all = await db.select().from(pages).orderBy(asc(pages.isSystem), asc(pages.id))

  // Block counts per page
  const counts = await db
    .select({ pageId: pageBlocks.pageId, count: sql<number>`count(*)` })
    .from(pageBlocks)
    .groupBy(pageBlocks.pageId)
  const countMap: Record<number, number> = {}
  for (const c of counts) countMap[c.pageId] = Number(c.count)

  const items = all.map((p) => ({ ...p, blockCount: countMap[p.id] ?? 0 }))
  return { ok: true, items }
})
