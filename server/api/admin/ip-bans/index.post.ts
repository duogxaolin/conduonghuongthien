/**
 * Add an address or IPv4 CIDR block to the ban list.
 *
 * The value goes through `validateBanValue` inside the service, before the insert
 * — a stored value that can never match produces a ban the officer believes is in
 * force (design.md D11). An IPv6 range is refused with a message naming the
 * limitation rather than stored and silently ignored.
 */
import { requireResourcePermission } from '../../../utils/permissions'
import { createIpBan } from '../../../services/ip-bans'

export default defineEventHandler(async (event) => {
  const actor = event.context.adminUser
  requireResourcePermission(actor, 'readers', 'update')

  const body = await readBody(event).catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Dữ liệu không hợp lệ.' })
  }

  const { value, reason } = body as Record<string, unknown>
  if (typeof value !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Hãy nhập địa chỉ IP cần chặn.' })
  }

  const result = await createIpBan({
    value,
    reason: typeof reason === 'string' ? reason.slice(0, 500) : null,
    actorId: actor.id,
  })

  if (!result.ok) throw createError({ statusCode: result.statusCode, statusMessage: result.message })

  setResponseStatus(event, 201)
  return { ok: true, id: result.id }
})
