import { getDb } from '../../../../../utils/db'
import { pageBlocks, activityLogs } from '../../../../../db/schema'
import { checkPermission } from '../../../../../utils/auth'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  if (!checkPermission(adminUser.permissions, 'pages', 'delete', adminUser.isSuperAdmin)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }

  const pageId = Number(getRouterParam(event, 'id'))
  const blockId = Number(getRouterParam(event, 'blockId'))
  if (!pageId || !blockId) throw createError({ statusCode: 400, statusMessage: 'Invalid ID' })

  const db = getDb()
  const [existing] = await db
    .select()
    .from(pageBlocks)
    .where(and(eq(pageBlocks.id, blockId), eq(pageBlocks.pageId, pageId)))
    .limit(1)
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Block không tồn tại.' })
  }

  await db.delete(pageBlocks).where(eq(pageBlocks.id, blockId))

  await db.insert(activityLogs).values({
    userId: adminUser.id,
    action: 'delete',
    resource: 'pages',
    meta: { pageId, blockId, blockType: existing.blockType },
  })

  return { ok: true }
})
