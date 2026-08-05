/**
 * Lift an address ban. The value is recorded in the audit row because after the
 * delete it is the only remaining evidence of what was lifted.
 */
import { requireResourcePermission } from '../../../utils/permissions'
import { deleteIpBan } from '../../../services/ip-bans'

export default defineEventHandler(async (event) => {
  const actor = event.context.adminUser
  requireResourcePermission(actor, 'readers', 'update')

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Mã mục chặn không hợp lệ.' })
  }

  const result = await deleteIpBan({ id: Math.floor(id), actorId: actor.id })
  if (!result.ok) throw createError({ statusCode: result.statusCode, statusMessage: result.message })

  return { ok: true }
})
