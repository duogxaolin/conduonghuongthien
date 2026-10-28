import { requireResourcePermission } from '../../../utils/permissions'
import { seedDefaultLanguagesAndTranslations } from '../../../services/languages'
import { getDb } from '../../../utils/db'
import { activityLogs } from '../../../db/schema'
import { logError } from '../../../utils/logger'

/**
 * The audit row is best-effort — the languages are already seeded when it is written, so a
 * failed insert must not answer "nothing happened" — but never silent: its failure is logged
 * with the actor and the counts, the trace that remains when `activity_logs` has none.
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'update')

  const result = await seedDefaultLanguagesAndTranslations()

  const db = getDb()
  try {
    await db.insert(activityLogs).values({
      userId: adminUser?.id ?? null,
      action: 'create',
      resource: 'settings',
      meta: {
        operation: 'seed_default_languages_and_translations',
        ...result,
      },
    })
  } catch (error) {
    logError({
      event: 'languages.seed_default_audit_failed',
      actorId: adminUser?.id ?? null,
      operation: 'seed_default_languages_and_translations',
      ...result,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  return {
    ok: true,
    result,
    message: `Đã nạp ${result.languagesSeeded} ngôn ngữ và ${result.translationsSeeded} bản dịch mặc định.`,
  }
})
