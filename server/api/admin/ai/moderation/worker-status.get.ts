import { requireResourcePermission } from '../../../../utils/permissions'
import { getWorkerStats } from '../../../../services/moderation-worker'
import { getModerationRescanStatus } from '../../../../services/moderation-rescan-job'
import { getDb } from '../../../../utils/db'
import { aiModerationQueue, aiServiceConfigs } from '../../../../db/schema'
import { eq, count } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'read')

  const db = getDb()

  // Get pending queue count
  const [queueCount] = await db
    .select({ total: count() })
    .from(aiModerationQueue)
    .where(eq(aiModerationQueue.status, 'pending'))

  // Get AI config status
  const [config] = await db
    .select()
    .from(aiServiceConfigs)
    .where(eq(aiServiceConfigs.serviceKey, 'moderation'))
    .limit(1)

  const stats = getWorkerStats()

  return {
    ok: true,
    // Lượt "Quét & dọn" chạy nền: trạng thái + tiến độ x/y cho trang kiểm duyệt.
    rescan: getModerationRescanStatus(),
    worker: {
      ...stats,
      pendingQueueCount: queueCount?.total ?? 0,
      aiServiceActive: config?.isActive ?? false,
      aiProvider: config?.provider ?? 'delify',
      aiModel: config?.model ?? 'delify-5.5',
    },
  }
})
