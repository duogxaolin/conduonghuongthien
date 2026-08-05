/**
 * The address ban list. Gated on `readers.read` — an address ban is a decision
 * about a person, and it sits with the rest of reader moderation rather than with
 * general settings.
 */
import { requireResourcePermission } from '../../../utils/permissions'
import { listIpBans } from '../../../services/ip-bans'

export default defineEventHandler(async (event) => {
  requireResourcePermission(event.context.adminUser, 'readers', 'read')
  return { ok: true, bans: await listIpBans() }
})
