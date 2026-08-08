import { getDb } from '../../../../../utils/db'
import { pages, pageBlocks, pageVersions, activityLogs } from '../../../../../db/schema'
import { normalizeBlocks, VERSION_LIMITS } from '../../../../../utils/page-versions'
import { and, asc, eq } from 'drizzle-orm'
import { requireResourcePermission } from '../../../../../utils/permissions'

// Create a 'manual' backup (max 4) or set the 'origin' baseline (replaces the
// previous origin). Snapshot source = current draft if present, else published.
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'pages', 'update')

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
      data: b.data ?? {},
      isVisible: !!b.isVisible,
    }))
  }
  // Strip ids from snapshots so restores never collide with live block ids.
  const cleanBlocks = snapshot.map(({ id, ...rest }) => rest)

  /**
   * One commit for the write and its audit line — and, on the origin path, for
   * the delete-then-insert pair as well.
   *
   * The origin branch is the one with a real data-loss window rather than just
   * an audit-loss one: it removes the existing baseline and then writes its
   * replacement. Unwrapped, a failure between those two statements leaves the
   * page with NO origin at all — the baseline an editor would reach for to undo
   * a bad edit is simply gone, and the audit line that would have explained it
   * never ran either.
   *
   * Everything runs on `tx`, not `db`: a `db.insert()` inside a transaction
   * block still commits independently on the pool, which is the same bug wearing
   * a transaction's clothes.
   */
  await db.transaction(async (tx) => {
    if (kind === 'manual') {
      /**
       * Counted inside the transaction, not before it. Read on the pool first,
       * two editors saving a backup at the same moment both see three and both
       * insert, landing five rows under a cap of four.
       */
      const existing = await tx
        .select({ id: pageVersions.id })
        .from(pageVersions)
        .where(and(eq(pageVersions.pageId, pageId), eq(pageVersions.kind, 'manual')))
      if (existing.length >= VERSION_LIMITS.manual) {
        throw createError({ statusCode: 400, statusMessage: `Đã đạt tối đa ${VERSION_LIMITS.manual} bản sao lưu. Vui lòng xóa bớt trước khi lưu mới.` })
      }
      await tx.insert(pageVersions).values({ pageId, kind: 'manual', label, blocks: cleanBlocks, createdBy: adminUser.id })
    } else {
      // origin: replace any previous origin (keep exactly 1).
      await tx.delete(pageVersions).where(and(eq(pageVersions.pageId, pageId), eq(pageVersions.kind, 'origin')))
      await tx.insert(pageVersions).values({ pageId, kind: 'origin', label: label || 'Bản gốc', blocks: cleanBlocks, createdBy: adminUser.id })
    }

    await tx.insert(activityLogs).values({
      userId: adminUser.id,
      action: 'create',
      resource: 'pages',
      meta: { pageId, action: 'version', kind },
    })
  })

  return { ok: true }
})
