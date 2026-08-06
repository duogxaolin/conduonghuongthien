import { getDb } from '../../../../../../utils/db'
import { pages, pageVersions, activityLogs } from '../../../../../../db/schema'
import { normalizeBlocks } from '../../../../../../utils/page-versions'
import { and, eq } from 'drizzle-orm'
import { requireResourcePermission } from '../../../../../../utils/permissions'

// Restore a version INTO THE DRAFT (not live). The editor previews it; the user
// must Publish to make it live. This keeps restore non-destructive.
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'pages', 'update')

  const pageId = Number(getRouterParam(event, 'id'))
  const versionId = Number(getRouterParam(event, 'versionId'))
  if (!pageId || !versionId) throw createError({ statusCode: 400, statusMessage: 'Invalid ID' })

  const db = getDb()
  const [version] = await db
    .select()
    .from(pageVersions)
    .where(and(eq(pageVersions.id, versionId), eq(pageVersions.pageId, pageId)))
    .limit(1)
  if (!version) throw createError({ statusCode: 404, statusMessage: 'Phiên bản không tồn tại.' })

  const blocks = normalizeBlocks(version.blocks)

  await db.update(pages).set({
    draftBlocks: blocks,
    draftUpdatedAt: new Date(),
    draftUpdatedBy: adminUser.id,
  }).where(eq(pages.id, pageId))

  await db.insert(activityLogs).values({
    userId: adminUser.id,
    action: 'update',
    resource: 'pages',
    meta: { pageId, action: 'restore', versionId, kind: version.kind },
  })

  return { ok: true, blocks }
})
