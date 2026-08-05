/**
 * Lift a ban.
 *
 * Restores nothing: the comments deleted by the ban are gone, and the reader's
 * old ticket stays dead so they sign in again. Both are stated in unbanReader —
 * an officer expecting "undo" would otherwise read a successful response as one.
 */
import { requireResourcePermission } from '../../../../utils/permissions'
import { unbanReader } from '../../../../services/readers'

export default defineEventHandler(async (event) => {
  const actor = event.context.adminUser
  requireResourcePermission(actor, 'readers', 'update')

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Mã người đọc không hợp lệ.' })
  }

  const result = await unbanReader({ readerId: Math.floor(id), actorId: actor.id })
  if (!result.ok) throw createError({ statusCode: result.statusCode, statusMessage: result.message })

  return { ok: true }
})
