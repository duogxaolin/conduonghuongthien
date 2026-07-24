import { getDb } from '../../../../../utils/db'
import { pageVersions } from '../../../../../db/schema'
import { checkPermission } from '../../../../../utils/auth'
import { eq, desc } from 'drizzle-orm'

// List version metadata for a page (no heavy blocks JSON).
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  if (!checkPermission(adminUser.permissions, 'pages', 'read', adminUser.isSuperAdmin)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }

  const pageId = Number(getRouterParam(event, 'id'))
  if (!pageId) throw createError({ statusCode: 400, statusMessage: 'Invalid page ID' })

  const db = getDb()
  const versions = await db
    .select({
      id: pageVersions.id,
      kind: pageVersions.kind,
      label: pageVersions.label,
      createdAt: pageVersions.createdAt,
      createdBy: pageVersions.createdBy,
      blockCount: pageVersions.blocks,
    })
    .from(pageVersions)
    .where(eq(pageVersions.pageId, pageId))
    .orderBy(desc(pageVersions.id))

  // Reduce blocks JSON to a count so the list payload stays small.
  const list = versions.map((v) => ({
    id: v.id,
    kind: v.kind,
    label: v.label,
    createdAt: v.createdAt,
    createdBy: v.createdBy,
    blockCount: Array.isArray(v.blockCount) ? v.blockCount.length : 0,
  }))

  return { ok: true, versions: list }
})
