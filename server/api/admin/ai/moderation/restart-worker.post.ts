import { requireResourcePermission } from '../../../../utils/permissions'
import { resetWorkerStats, invalidateModerationRulesCache } from '../../../../services/moderation-worker'
import { getDb } from '../../../../utils/db'
import { activityLogs } from '../../../../db/schema'
import { logError } from '../../../../utils/logger'

/**
 * The audit row is best-effort — the counters and the rule cache are already reset when it is
 * written, so a failed insert must not answer "nothing happened" — but never silent: its
 * failure is logged with the actor, the trace that remains when `activity_logs` has none.
 */
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
  } catch (error) {
    logError({
      event: 'ai_moderation.restart_worker_audit_failed',
      actorId: adminUser?.id ?? null,
      operation: 'restart_moderation_worker',
      error: error instanceof Error ? error.message : String(error),
    })
  }

  return { ok: true, message: 'Đã khởi động lại Moderation Worker và làm mới bộ đệm quy tắc thành công.' }
})
