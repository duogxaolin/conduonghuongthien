import { requireResourcePermission } from '../../../../../utils/permissions'
import { deletePageVersionWithAudit, findPageVersion } from '../../../../../services/admin-page-versions'

// Delete a single version. Origin is protected (must be replaced via POST).
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'pages', 'delete')

  const pageId = Number(getRouterParam(event, 'id'))
  const versionId = Number(getRouterParam(event, 'versionId'))
  if (!pageId || !versionId) throw createError({ statusCode: 400, statusMessage: 'Invalid ID' })

  const existing = await findPageVersion(pageId, versionId)
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Phiên bản không tồn tại.' })
  if (existing.kind === 'origin') {
    throw createError({ statusCode: 400, statusMessage: 'Không thể xóa bản gốc. Hãy chỉ định bản gốc khác để thay thế.' })
  }

  // The delete and its audit row commit together (services/admin-page-versions.ts).
  await deletePageVersionWithAudit(adminUser, pageId, versionId, existing)

  return { ok: true }
})
