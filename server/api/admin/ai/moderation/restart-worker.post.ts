import { requireResourcePermission } from '../../../../utils/permissions'
import { resetWorkerStats, invalidateModerationRulesCache } from '../../../../services/moderation-worker'
import { getDb } from '../../../../utils/db'
import { activityLogs } from '../../../../db/schema'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'update')

  resetWorkerStats()
  invalidateModerationRulesCache()

  const db = getDb()
  try {
    await db.insert(activityLogs).values({
      userId: adminUser?.id ?? null,
      action: 'update',
      resource: 'ai',
      meta: { operation: 'restart_moderation_worker' },
    })
  } catch {
    // Non-blocking
  }

  return { ok: true, message: 'Đã khởi động lại Moderation Worker và làm mới bộ đệm quy tắc thành công.' }
})
