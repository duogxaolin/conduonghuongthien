import { getClientIp } from '../../../utils/client-ip'
import { logError, logWarn } from '../../../utils/logger'
import { auditAdminLogout, bumpAdminTokenVersion } from '../../../services/admin-auth-logout'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser

  if (adminUser?.id) {
    // Invalidate the token itself, not just the cookie. Clearing the cookie
    // alone left a stolen token usable for the rest of its 8h lifetime; bumping
    // the user's token version makes every previously issued token fail the
    // check in server/middleware/admin-auth.ts immediately.
    // NOTE: this signs the account out on ALL devices — deliberate for an admin
    // panel, where "log me out" should mean everywhere.
    // Two separate pool writes, each best-effort — never one transaction
    // (services/admin-auth-logout.ts): a failed audit must not undo the bump.
    try {
      await bumpAdminTokenVersion(adminUser.id)
    } catch (error) {
      logError({
        event: 'auth.logout_token_invalidation_failed',
        userId: adminUser.id,
        username: adminUser.username,
        error,
        consequence: 'old tokens remain valid for rest of 8h lifetime',
      })
    }

    try {
      // This alone read the raw header, which any client can set: the audit trail
      // for "who signed out" was writing whatever the caller claimed.
      await auditAdminLogout(adminUser.id, { ip: getClientIp(event) })
    } catch (error) {
      logWarn({
        event: 'auth.logout_audit_failed',
        userId: adminUser.id,
        username: adminUser.username,
        error,
        consequence: 'logout event missing from activity_logs',
      })
    }
  }

  deleteCookie(event, 'cdkt_admin', {
    path: '/',
  })

  return { ok: true }
})
