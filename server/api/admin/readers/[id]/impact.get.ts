/**
 * What a ban or an account deletion is about to remove, measured before anything
 * is removed.
 *
 * Read-only, and it exists so the confirmation dialog can state two separate
 * numbers: the reader's own comments, and the administrator replies that go with
 * them (design.md D8). An officer told only "3 bình luận" is agreeing to
 * something different from what happens — the portal's own published answers
 * disappear too.
 *
 * Not audited: this is the dialog reading its own labels, and it always precedes
 * either a cancel or an operation that writes its own row with the same counts.
 * Logging it would double every ban into two entries that look like two actions.
 */
import { requireResourcePermission } from '../../../../utils/permissions'
import { countReaderCommentImpact } from '../../../../services/comments'

export default defineEventHandler(async (event) => {
  requireResourcePermission(event.context.adminUser, 'readers', 'read')

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Mã người đọc không hợp lệ.' })
  }

  return { ok: true, impact: await countReaderCommentImpact(Math.floor(id)) }
})
