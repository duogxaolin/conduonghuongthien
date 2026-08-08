import { getDb } from '../../../../../utils/db'
import { pageBlocks, activityLogs } from '../../../../../db/schema'
import { and, eq } from 'drizzle-orm'
import { requireResourcePermission } from '../../../../../utils/permissions'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'pages', 'delete')

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

  /**
   * The block and its audit line commit together, or neither does. Written
   * unwrapped, a failed audit insert (`activity_logs.user_id` is a foreign key,
   * `meta` is JSON) leaves a block deleted from a live page with nothing
   * recording who removed it. Runs on `tx`, not `db`: a `db.insert()` inside a
   * transaction block still commits independently on the pool.
   */
  await db.transaction(async (tx) => {
    await tx.delete(pageBlocks).where(eq(pageBlocks.id, blockId))

    await tx.insert(activityLogs).values({
      userId: adminUser.id,
      action: 'delete',
      resource: 'pages',
      meta: { pageId, blockId, blockType: existing.blockType },
    })
  })

  return { ok: true }
})
