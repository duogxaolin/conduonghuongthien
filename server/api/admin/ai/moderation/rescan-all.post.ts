import { requireResourcePermission } from '../../../../utils/permissions'
import { rescanExistingContent } from '../../../../services/moderation-worker'
import { getDb } from '../../../../utils/db'
import { activityLogs } from '../../../../db/schema'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'update')

  const result = await rescanExistingContent()

  // Audit the rescan action
  const db = getDb()
  try {
    await db.insert(activityLogs).values({
      userId: adminUser?.id ?? null,
      action: 'update',
      resource: 'ai',
      meta: {
        operation: 'moderation_rescan_all',
        ...result,
      },
    })
  } catch {
    // Non-blocking audit
  }

  return {
    ok: true,
    result,
    message: `Đã quét ${result.scannedComments} bình luận (ẩn ${result.hiddenComments}), ${result.scannedMessages} tin chat (xóa ${result.deletedMessages}).`,
  }
})
