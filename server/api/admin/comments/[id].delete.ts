/**
 * Delete one comment as an administrator.
 *
 * Goes through the shared `deleteComment` path (design.md D8), which writes the
 * audit row and lets the FK cascade take the replies under a top-level comment —
 * including an official one. The confirmation dialog on the page counts those
 * separately before asking.
 *
 * Unlike the reader path, an administrator MAY delete an administrator reply:
 * that restriction exists so readers cannot remove the portal's answers, not to
 * stop the portal from correcting itself.
 */
import { requireResourcePermission } from '../../../utils/permissions'
import { deleteComment } from '../../../services/comments'

export default defineEventHandler(async (event) => {
  const actor = event.context.adminUser
  requireResourcePermission(actor, 'comments', 'delete')

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Mã bình luận không hợp lệ.' })
  }

  const result = await deleteComment({ id: Math.floor(id), actor: { kind: 'admin', userId: actor.id } })
  if (!result.ok) throw createError({ statusCode: result.statusCode, statusMessage: result.message })

  return { ok: true }
})
