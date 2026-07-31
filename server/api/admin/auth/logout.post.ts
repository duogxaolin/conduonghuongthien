import { eq, sql } from 'drizzle-orm'
import { getDb } from '../../../utils/db'
import { getClientIp } from '../../../utils/client-ip'
import { users, activityLogs } from '../../../db/schema'

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
    await db.update(users)
      .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.id, adminUser.id))
      .catch(() => {})

    await db.insert(activityLogs).values({
      userId: adminUser.id,
      action: 'logout',
      resource: 'auth',
      // This alone read the raw header, which any client can set: the audit trail
      // for "who signed out" was writing whatever the caller claimed.
      meta: { ip: getClientIp(event) },
    }).catch(() => {})
  }

  deleteCookie(event, 'cdkt_admin', {
    path: '/',
  })

  return { ok: true }
})
