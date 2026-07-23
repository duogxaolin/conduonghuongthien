import { getDb } from '../../../../../utils/db'
import { pages, pageBlocks, activityLogs } from '../../../../../db/schema'
import { checkPermission } from '../../../../../utils/auth'
import { isValidBlockType, getDefaultData } from '../../../../../../app/utils/blocks/registry'
import { eq, sql } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  if (!checkPermission(adminUser.permissions, 'pages', 'create', adminUser.isSuperAdmin)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }

  const pageId = Number(getRouterParam(event, 'id'))
  if (!pageId) throw createError({ statusCode: 400, statusMessage: 'Invalid page ID' })

  const body = await readBody(event).catch(() => ({}))
  const blockType = String(body?.blockType || '').trim()
  if (!isValidBlockType(blockType)) {
    throw createError({ statusCode: 400, statusMessage: 'Loại block không hợp lệ.' })
  }

  const db = getDb()
  const [page] = await db.select().from(pages).where(eq(pages.id, pageId)).limit(1)
  if (!page) {
    throw createError({ statusCode: 404, statusMessage: 'Trang không tồn tại.' })
  }

  // Next display order = current max + 1
  const [{ maxOrder }] = await db
    .select({ maxOrder: sql<number>`coalesce(max(${pageBlocks.displayOrder}), 0)` })
    .from(pageBlocks)
    .where(eq(pageBlocks.pageId, pageId))

  const data = body?.data && typeof body.data === 'object' ? body.data : getDefaultData(blockType)

  const [res] = await db.insert(pageBlocks).values({
    pageId,
    blockType,
    displayOrder: Number(maxOrder) + 1,
    data: data as any,
    isVisible: true,
    updatedBy: adminUser.id,
  })

  const insertedId = (res as any).insertId

  await db.insert(activityLogs).values({
    userId: adminUser.id,
    action: 'create',
    resource: 'pages',
    meta: { pageId, blockId: Number(insertedId), blockType },
  })

  const [block] = await db.select().from(pageBlocks).where(eq(pageBlocks.id, Number(insertedId))).limit(1)
  return { ok: true, block }
})
