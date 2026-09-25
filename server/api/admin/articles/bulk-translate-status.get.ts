import { count, eq } from 'drizzle-orm'
import { getDb } from '../../../utils/db'
import { articleTranslations } from '../../../db/schema'
import { requireResourcePermission } from '../../../utils/permissions'
import { getBulkTranslationTaskState } from '../../../services/article-translations'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'news', 'read')

  const state = getBulkTranslationTaskState()
  const db = getDb()

  const [translatingRow] = await db
    .select({ count: count() })
    .from(articleTranslations)
    .where(eq(articleTranslations.status, 'translating'))

  const dbTranslatingCount = Number(translatingRow?.count || 0)

  return {
    ok: true,
    active: state.active || dbTranslatingCount > 0,
    task: state,
    dbTranslatingCount,
  }
})
