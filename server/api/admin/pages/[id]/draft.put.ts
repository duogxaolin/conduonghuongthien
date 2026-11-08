import { normalizeBlocks } from '../../../../utils/page-versions'
import { requireResourcePermission } from '../../../../utils/permissions'
import { findPageById } from '../../../../services/admin-pages-queries'
import { clearPageDraft, savePageDraft } from '../../../../services/admin-page-draft'

// Save the unpublished working copy (draft). Does NOT touch page_blocks (live).
// The read and the write are not in one transaction, and not audited — as before the
// move (services/admin-page-draft.ts says what that leaves open).
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'pages', 'update')

  const pageId = Number(getRouterParam(event, 'id'))
  if (!pageId) throw createError({ statusCode: 400, statusMessage: 'Invalid page ID' })

  const body = await readBody(event).catch(() => ({}))

  const page = await findPageById(pageId)
  if (!page) throw createError({ statusCode: 404, statusMessage: 'Trang không tồn tại.' })

  // No blocks array in the body → clear the draft (revert to live). An explicit
  // (possibly empty) array is saved as-is so a genuinely empty page can be drafted.
  if (!Array.isArray(body?.blocks)) {
    await clearPageDraft(pageId)
    return { ok: true, cleared: true, savedAt: new Date().toISOString() }
  }

  const blocks = normalizeBlocks(body.blocks)
  await savePageDraft(pageId, blocks, adminUser)

  return { ok: true, savedAt: new Date().toISOString() }
})
