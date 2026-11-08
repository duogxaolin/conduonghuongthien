import { normalizeBlocks } from '../../../../../utils/page-versions'
import { requireResourcePermission } from '../../../../../utils/permissions'
import { findPageById, listPageBlockRows } from '../../../../../services/admin-pages-queries'
import { savePageVersionWithAudit } from '../../../../../services/admin-page-versions'

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

  const page = await findPageById(pageId)
  if (!page) throw createError({ statusCode: 404, statusMessage: 'Trang không tồn tại.' })

  // Snapshot source: explicit body.blocks → draft → published.
  let snapshot = normalizeBlocks(body?.blocks)
  if (!snapshot.length && Array.isArray(page.draftBlocks)) {
    snapshot = normalizeBlocks(page.draftBlocks)
  }
  if (!snapshot.length) {
    const published = await listPageBlockRows(pageId)
    snapshot = published.map((b) => ({
      blockType: b.blockType,
      displayOrder: b.displayOrder,
      data: b.data ?? {},
      isVisible: !!b.isVisible,
    }))
  }
  // Strip ids from snapshots so restores never collide with live block ids.
  const cleanBlocks = snapshot.map(({ id: _id, ...rest }) => rest)

  // The write (origin: delete-then-insert; manual: the cap counted inside the transaction) and
  // its audit row commit together (services/admin-page-versions.ts).
  await savePageVersionWithAudit(adminUser, pageId, kind, label, cleanBlocks)

  return { ok: true }
})
