import { requireResourcePermission } from '../../../../utils/permissions'
import { getDb } from '../../../../utils/db'
import { activityLogs } from '../../../../db/schema'
import { logInfo } from '../../../../utils/logger'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'update')

  const db = getDb()
  try {
    await db.insert(activityLogs).values({
      userId: adminUser?.id ?? null,
      action: 'update',
      resource: 'ai',
      meta: { operation: 'restart_website_server' },
    })
  } catch {
    // Non-blocking
  }

  logInfo({
    event: 'system.restart_requested',
    requestedBy: adminUser?.id,
  })

  // Schedule graceful exit after responding to the client
  setTimeout(() => {
    process.exit(0)
  }, 1000)

  return {
    ok: true,
    message: 'Máy chủ website đang được khởi động lại. Hệ thống sẽ sẵn sàng sau 3-5 giây.',
  }
})
