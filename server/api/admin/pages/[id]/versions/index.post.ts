import { getDb } from '../../../../../utils/db'
import { pages, pageBlocks, pageVersions, activityLogs } from '../../../../../db/schema'
import { checkPermission } from '../../../../../utils/auth'
import { normalizeBlocks, VERSION_LIMITS } from '../../../../../utils/page-versions'
import { and, asc, eq } from 'drizzle-orm'

// Create a 'manual' backup (max 4) or set the 'origin' baseline (replaces the
// previous origin). Snapshot source = current draft if present, else published.
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  if (!checkPermission(adminUser.permissions, 'pages', 'update', adminUser.isSuperAdmin)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }

  const pageId = Number(getRouterParam(event, 'id'))
  if (!pageId) throw createError({ statusCode: 400, statusMessage: 'Invalid page ID' })

  const body = await readBody(event).catch(() => ({}))
  const kind = body?.kind === 'origin' ? 'origin' : 'manual'
  const label = String(body?.label || '').trim().slice(0, 128) || null

  const db = getDb()
  const [page] = await db.select().from(pages).where(eq(pages.id, pageId)).limit(1)
  if (!page) throw createError({ statusCode: 404, statusMessage: 'Trang không tồn tại.' })

  // Snapshot source: explicit body.blocks → draft → published.
  let snapshot = normalizeBlocks(body?.blocks)
  if (!snapshot.length && Array.isArray(page.draftBlocks)) {
    snapshot = normalizeBlocks(page.draftBlocks)
  }
  if (!snapshot.length) {
    const published = await db
      .select()
      .from(pageBlocks)
      .where(eq(pageBlocks.pageId, pageId))
      .orderBy(asc(pageBlocks.displayOrder), asc(pageBlocks.id))
    snapshot = published.map((b) => ({
      blockType: b.blockType,
      displayOrder: b.displayOrder,
      data: b.data,
      isVisible: !!b.isVisible,
    }))
  }
  // Strip ids from snapshots so restores never collide with live block ids.
  const cleanBlocks = snapshot.map(({ id, ...rest }) => rest)

  if (kind === 'manual') {
    const existing = await db
      .select({ id: pageVersions.id })
      .from(pageVersions)
      .where(and(eq(pageVersions.pageId, pageId), eq(pageVersions.kind, 'manual')))
    if (existing.length >= VERSION_LIMITS.manual) {
      throw createError({ statusCode: 400, statusMessage: `Đã đạt tối đa ${VERSION_LIMITS.manual} bản sao lưu. Vui lòng xóa bớt trước khi lưu mới.` })
    }
    await db.insert(pageVersions).values({ pageId, kind: 'manual', label, blocks: cleanBlocks, createdBy: adminUser.id })
  } else {
    // origin: replace any previous origin (keep exactly 1).
    await db.delete(pageVersions).where(and(eq(pageVersions.pageId, pageId), eq(pageVersions.kind, 'origin')))
    await db.insert(pageVersions).values({ pageId, kind: 'origin', label: label || 'Bản gốc', blocks: cleanBlocks, createdBy: adminUser.id })
  }

  await db.insert(activityLogs).values({
    userId: adminUser.id,
    action: 'create',
    resource: 'pages',
    meta: { pageId, action: 'version', kind },
  })

  return { ok: true }
})
