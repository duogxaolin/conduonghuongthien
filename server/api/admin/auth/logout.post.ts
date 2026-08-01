import { eq, sql } from 'drizzle-orm'
import { getDb } from '../../../utils/db'
import { getClientIp } from '../../../utils/client-ip'
import { users, activityLogs } from '../../../db/schema'
import { logError, logWarn } from '../../../utils/logger'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser

  if (adminUser?.id) {
    const db = getDb()

    // Invalidate the token itself, not just the cookie. Clearing the cookie
    // alone left a stolen token usable for the rest of its 8h lifetime; bumping
    // the user's token version makes every previously issued token fail the
    // check in server/middleware/admin-auth.ts immediately.
    // NOTE: this signs the account out on ALL devices — deliberate for an admin
    // panel, where "log me out" should mean everywhere.
    try {
      await db.update(users)
        .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
        .where(eq(users.id, adminUser.id))
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
      await db.insert(activityLogs).values({
        userId: adminUser.id,
        action: 'logout',
        resource: 'auth',
        // This alone read the raw header, which any client can set: the audit trail
        // for "who signed out" was writing whatever the caller claimed.
        meta: { ip: getClientIp(event) },
      })
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
