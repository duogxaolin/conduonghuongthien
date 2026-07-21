import { getDb } from '../../utils/db'
import { activityLogs } from '../../db/schema'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser

  if (adminUser?.id) {
    const db = getDb()
    await db.insert(activityLogs).values({
      userId: adminUser.id,
      action: 'logout',
      resource: 'auth',
      meta: { ip: getRequestHeader(event, 'x-forwarded-for') || 'unknown' },
    }).catch(() => {})
  }

  deleteCookie(event, 'cdkt_admin', {
    path: '/',
  })

  return { ok: true }
})
