/**
 * Remove every comment this reader wrote, leaving the account able to post again.
 *
 * Gated on `comments.delete` rather than `readers.delete`: what is being removed
 * is comments, and an officer trusted to clear a thread is not thereby trusted to
 * delete citizen accounts.
 */
import { requireResourcePermission } from '../../../../utils/permissions'
import { purgeReaderComments } from '../../../../services/readers'

export default defineEventHandler(async (event) => {
  const actor = event.context.adminUser
  requireResourcePermission(actor, 'comments', 'delete')

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Mã người đọc không hợp lệ.' })
  }

  const result = await purgeReaderComments({ readerId: Math.floor(id), actorId: actor.id })
  if (!result.ok) throw createError({ statusCode: result.statusCode, statusMessage: result.message })

  return { ok: true, impact: result.impact }
})
