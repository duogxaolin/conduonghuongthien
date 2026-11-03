import { requireResourcePermission } from '../../../utils/permissions'
import { syncLanguageKeys } from '../../../services/languages'
import { getDb } from '../../../utils/db'
import { activityLogs } from '../../../db/schema'
import { logError } from '../../../utils/logger'

/**
 * The audit row is best-effort — the keys are already synced when it is written, so a failed
 * insert must not answer "nothing happened" — but never silent: its failure is logged with
 * the actor and the counts, the trace that remains when `activity_logs` has none.
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'update')

  const result = await syncLanguageKeys()

  const db = getDb()
  try {
    await db.insert(activityLogs).values({
      userId: adminUser?.id ?? null,
      action: 'update',
      resource: 'settings',
      meta: {
        operation: 'sync_language_keys',
        ...result,
      },
    })
  } catch (error) {
    logError({
      event: 'languages.sync_audit_failed',
      actorId: adminUser?.id ?? null,
      operation: 'sync_language_keys',
      ...result,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  return {
    ok: true,
    result,
    message: result.synced > 0
      ? `Đã đồng bộ ${result.synced} khóa ngôn ngữ còn thiếu vào CSDL.`
      : 'Tất cả các ngôn ngữ đã được đồng bộ đầy đủ các khóa từ ngôn ngữ mặc định.',
  }
})
