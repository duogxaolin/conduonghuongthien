import { getDb } from '../../../../utils/db'
import { pages } from '../../../../db/schema'
import { checkPermission } from '../../../../utils/auth'
import { normalizeBlocks } from '../../../../utils/page-versions'
import { eq } from 'drizzle-orm'

// Save the unpublished working copy (draft). Does NOT touch page_blocks (live).
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  if (!checkPermission(adminUser.permissions, 'pages', 'update', adminUser.isSuperAdmin)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }

  const pageId = Number(getRouterParam(event, 'id'))
  if (!pageId) throw createError({ statusCode: 400, statusMessage: 'Invalid page ID' })

  const body = await readBody(event).catch(() => ({}))

  const db = getDb()
  const [page] = await db.select().from(pages).where(eq(pages.id, pageId)).limit(1)
  if (!page) throw createError({ statusCode: 404, statusMessage: 'Trang không tồn tại.' })

  // No blocks array in the body → clear the draft (revert to live). An explicit
  // (possibly empty) array is saved as-is so a genuinely empty page can be drafted.
  if (!Array.isArray(body?.blocks)) {
    await db.update(pages).set({ draftBlocks: null, draftUpdatedAt: null, draftUpdatedBy: null }).where(eq(pages.id, pageId))
    return { ok: true, cleared: true, savedAt: new Date().toISOString() }
  }

  const blocks = normalizeBlocks(body.blocks)
  await db.update(pages).set({
    draftBlocks: blocks,
    draftUpdatedAt: new Date(),
    draftUpdatedBy: adminUser.id,
  }).where(eq(pages.id, pageId))

  return { ok: true, savedAt: new Date().toISOString() }
})
