import { requireResourcePermission } from '../../../utils/permissions'
import { seedDefaultLanguagesAndTranslations } from '../../../services/languages'
import { getDb } from '../../../utils/db'
import { activityLogs } from '../../../db/schema'

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
  } catch {
    // Non-blocking audit
  }

  return {
    ok: true,
    result,
    message: `Đã nạp ${result.languagesSeeded} ngôn ngữ và ${result.translationsSeeded} bản dịch mặc định.`,
  }
})
