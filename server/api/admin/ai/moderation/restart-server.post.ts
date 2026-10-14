import { requireResourcePermission } from '../../../../utils/permissions'
import { getDb } from '../../../../utils/db'
import { activityLogs } from '../../../../db/schema'
import { logInfo } from '../../../../utils/logger'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'update')
  // `ai.update` lets an officer tune moderation; it is not a licence to take the
  // whole portal down (`process.exit`). Restarting the server is a super-admin
  // action. Inline check on purpose: a shared `requireSuperAdmin` helper is being
  // added to utils/permissions.ts in a parallel change — switch to it once merged.
  // `isSuperAdmin` is set by server/middleware/admin-auth.ts from the role row
  // (`isSystem`), never from anything in the token.
  if (adminUser?.isSuperAdmin !== true) {
    throw createError({ statusCode: 403, statusMessage: 'Chỉ quản trị viên tối cao mới được khởi động lại máy chủ website.' })
  }

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
