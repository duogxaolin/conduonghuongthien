import { requireResourcePermission } from '../../../../utils/permissions'
import { getWorkerStats } from '../../../../services/moderation-worker'
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
    worker: {
      ...stats,
      pendingQueueCount: queueCount?.total ?? 0,
      aiServiceActive: config?.isActive ?? false,
      aiProvider: config?.provider ?? 'delify',
      aiModel: config?.model ?? 'delify-5.5',
    },
  }
})
