/**
 * A reader deletes their own comment.
 *
 * The ownership rule and the "an administrator reply is not reader-deletable"
 * rule both live in `deleteComment` (design.md D8), which is the single deletion
 * path shared by self-delete, admin delete, bulk delete, ban, account deletion
 * and the retention purge. Re-implementing either check here would put the
 * reader path one refactor away from disagreeing with the other five.
 *
 * There is no PUT or PATCH beside this file, and there never should be: a public
 * comment that can be rewritten after the fact is a record of nothing, and an
 * official reply could end up under a question that no longer resembles the one
 * it answered. Correcting a comment means deleting it and posting again.
 */
import { requireReader } from '../../../utils/reader-auth'
import { deleteComment } from '../../../services/comments'

export default defineEventHandler(async (event) => {
  const reader = await requireReader(event)

  const raw = getRouterParam(event, 'id')
  const id = Number(raw)
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bình luận không hợp lệ.' })
  }

  const result = await deleteComment({ id: Math.floor(id), actor: { kind: 'reader', readerId: reader.id } })
  if (!result.ok) throw createError({ statusCode: result.statusCode, statusMessage: result.message })

  return { ok: true }
})
