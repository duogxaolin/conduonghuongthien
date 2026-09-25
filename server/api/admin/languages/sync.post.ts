import { requireResourcePermission } from '../../../utils/permissions'
import { syncLanguageKeys } from '../../../services/languages'
import { getDb } from '../../../utils/db'
import { activityLogs } from '../../../db/schema'

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
  } catch {
    // Non-blocking
  }

  return {
    ok: true,
    result,
    message: result.synced > 0
      ? `Đã đồng bộ ${result.synced} khóa ngôn ngữ còn thiếu vào CSDL.`
      : 'Tất cả các ngôn ngữ đã được đồng bộ đầy đủ các khóa từ ngôn ngữ mặc định.',
  }
})
