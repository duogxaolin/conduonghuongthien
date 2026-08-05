/**
 * Ban a reader account. Flag, token bump and comment deletion land together or
 * not at all — see banReader.
 *
 * `update` on `readers`, not `delete`, even though it deletes comments: the
 * subject of the action is the account, and an officer trusted to ban is the same
 * officer trusted to take the comments down with it. The confirmation dialog has
 * already shown both counts from the impact endpoint.
 */
import { requireResourcePermission } from '../../../../utils/permissions'
import { banReader } from '../../../../services/readers'

export default defineEventHandler(async (event) => {
  const actor = event.context.adminUser
  requireResourcePermission(actor, 'readers', 'update')

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Mã người đọc không hợp lệ.' })
  }

  const body = await readBody(event).catch(() => null)
  const rawReason = (body as { reason?: unknown } | null)?.reason
  const reason = typeof rawReason === 'string' ? rawReason.trim().slice(0, 500) : null

  const result = await banReader({ readerId: Math.floor(id), reason: reason || null, actorId: actor.id })
  if (!result.ok) throw createError({ statusCode: result.statusCode, statusMessage: result.message })

  return { ok: true, impact: result.impact }
})
