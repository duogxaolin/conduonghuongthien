import { requireResourcePermission } from '../../../utils/permissions'
import { seedDefaultLanguagesAndTranslations } from '../../../services/languages'
import { writeLanguagesSeedDefaultAudit } from '../../../services/admin-languages-audit'
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

  try {
    await writeLanguagesSeedDefaultAudit(adminUser?.id ?? null, result)
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
