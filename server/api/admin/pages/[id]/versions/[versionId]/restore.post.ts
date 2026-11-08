import { normalizeBlocks } from '../../../../../../utils/page-versions'
import { requireResourcePermission } from '../../../../../../utils/permissions'
import { findPageVersion, restorePageVersionWithAudit } from '../../../../../../services/admin-page-versions'

// Restore a version INTO THE DRAFT (not live). The editor previews it; the user
// must Publish to make it live. This keeps restore non-destructive.
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'pages', 'update')

  const pageId = Number(getRouterParam(event, 'id'))
  const versionId = Number(getRouterParam(event, 'versionId'))
  if (!pageId || !versionId) throw createError({ statusCode: 400, statusMessage: 'Invalid ID' })

  const version = await findPageVersion(pageId, versionId)
  if (!version) throw createError({ statusCode: 404, statusMessage: 'Phiên bản không tồn tại.' })

  const blocks = normalizeBlocks(version.blocks)

  // The draft write and its audit row commit together (services/admin-page-versions.ts).
  await restorePageVersionWithAudit(adminUser, pageId, versionId, version, blocks)

  return { ok: true, blocks }
})
