import { requireResourcePermission } from '../../../../utils/permissions'
import { getWorkerStats } from '../../../../services/moderation-worker'
import { getModerationRescanStatus } from '../../../../services/moderation-rescan-job'
import { readModerationWorkerCounts } from '../../../../services/admin-ai-moderation-settings'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'read')

  // The pending queue count, then the AI config status.
  const { queueCount, config } = await readModerationWorkerCounts()

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
