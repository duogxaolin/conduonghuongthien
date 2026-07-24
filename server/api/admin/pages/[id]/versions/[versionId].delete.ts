import { getDb } from '../../../../../utils/db'
import { pageVersions, activityLogs } from '../../../../../db/schema'
import { checkPermission } from '../../../../../utils/auth'
import { and, eq } from 'drizzle-orm'

// Delete a single version. Origin is protected (must be replaced via POST).
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  if (!checkPermission(adminUser.permissions, 'pages', 'delete', adminUser.isSuperAdmin)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }

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

  await db.delete(pageVersions).where(eq(pageVersions.id, versionId))

  await db.insert(activityLogs).values({
    userId: adminUser.id,
    action: 'delete',
    resource: 'pages',
    meta: { pageId, versionId, kind: existing.kind },
  })

  return { ok: true }
})
