import { getDb } from '../../../../../utils/db'
import { pageVersions, activityLogs } from '../../../../../db/schema'
import { and, eq } from 'drizzle-orm'
import { requireResourcePermission } from '../../../../../utils/permissions'

// Delete a single version. Origin is protected (must be replaced via POST).
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'pages', 'delete')

  const pageId = Number(getRouterParam(event, 'id'))
  const versionId = Number(getRouterParam(event, 'versionId'))
  if (!pageId || !versionId) throw createError({ statusCode: 400, statusMessage: 'Invalid ID' })

  const db = getDb()
  const [existing] = await db
    .select()
    .from(pageVersions)
    .where(and(eq(pageVersions.id, versionId), eq(pageVersions.pageId, pageId)))
    .limit(1)
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Phiên bản không tồn tại.' })
  if (existing.kind === 'origin') {
    throw createError({ statusCode: 400, statusMessage: 'Không thể xóa bản gốc. Hãy chỉ định bản gốc khác để thay thế.' })
  }

  /**
   * The version and its audit line commit together, or neither does. A saved
   * backup vanishing with no record of who discarded it defeats the purpose of
   * keeping versions at all. Runs on `tx`, not `db`: a `db.insert()` inside a
   * transaction block still commits independently on the pool.
   */
  await db.transaction(async (tx) => {
    await tx.delete(pageVersions).where(eq(pageVersions.id, versionId))

    await tx.insert(activityLogs).values({
      userId: adminUser.id,
      action: 'delete',
      resource: 'pages',
      meta: { pageId, versionId, kind: existing.kind },
    })
  })

  return { ok: true }
})
