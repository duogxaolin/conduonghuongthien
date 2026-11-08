import { requireResourcePermission } from '../../../../../utils/permissions'
import { listPageVersionsMeta } from '../../../../../services/admin-page-versions'

// List version metadata for a page (no heavy blocks JSON).
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'pages', 'read')

  const pageId = Number(getRouterParam(event, 'id'))
  if (!pageId) throw createError({ statusCode: 400, statusMessage: 'Invalid page ID' })

  const versions = await listPageVersionsMeta(pageId)

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
