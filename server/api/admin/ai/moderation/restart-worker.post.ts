import { requireResourcePermission } from '../../../../utils/permissions'
import { resetWorkerStats, invalidateModerationRulesCache } from '../../../../services/moderation-worker'
import { writeWorkerRestartAudit } from '../../../../services/admin-ai-moderation-ops'

/**
 * The audit row is best-effort — the counters and the rule cache are already reset when it is
 * written, so a failed insert must not answer "nothing happened" — but never silent: its
 * failure is logged with the actor, the trace that remains when `activity_logs` has none
 * (`writeWorkerRestartAudit`, admin-ai-moderation-ops.ts).
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'update')

  resetWorkerStats()
  invalidateModerationRulesCache()

  await writeWorkerRestartAudit(adminUser)

  return { ok: true, message: 'Đã khởi động lại Moderation Worker và làm mới bộ đệm quy tắc thành công.' }
})
