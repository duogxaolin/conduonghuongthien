/**
 * Delete a reader account. Comments follow by FK cascade, and the administrator
 * replies under them follow by the parent cascade (design.md D8).
 *
 * Not reversible, which is why the confirmation dialog reads its counts from the
 * impact endpoint first and says so out loud.
 */
import { requireResourcePermission } from '../../../utils/permissions'
import { deleteReader } from '../../../services/readers'

export default defineEventHandler(async (event) => {
  const actor = event.context.adminUser
  requireResourcePermission(actor, 'readers', 'delete')

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Mã người đọc không hợp lệ.' })
  }

  const result = await deleteReader({ readerId: Math.floor(id), actorId: actor.id })
  if (!result.ok) throw createError({ statusCode: result.statusCode, statusMessage: result.message })

  return { ok: true, impact: result.impact }
})
