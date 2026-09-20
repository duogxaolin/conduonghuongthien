import { eq } from 'drizzle-orm'
import { getDb, type Database } from '../utils/db'
import { activityLogs, mediaItems } from '../db/schema'

/** Manual retry resets the bounded automatic retry budget, atomically with its audit entry. */
export async function enqueueMediaProcessing(mediaItemId: number, actorId: number, db: Database = getDb()) {
  return db.transaction(async tx => {
    const [item] = await tx.select().from(mediaItems).where(eq(mediaItems.id, mediaItemId)).limit(1).for('update')
    if (!item) return { ok: false as const, status: 404, message: 'Không tìm thấy mục media này.' }
    if (item.source !== 'upload') return { ok: false as const, status: 400, message: 'Chỉ mục tự lưu trữ mới cần chuyển mã.' }
    if (item.processingStatus === 'failed') {
      await tx.update(mediaItems).set({ processingStatus: 'pending', processingAttempts: 0,
        processingNextAttemptAt: null, processingHeartbeatAt: null, claimedBy: null, processingError: null,
      }).where(eq(mediaItems.id, mediaItemId))
      await tx.insert(activityLogs).values({ userId: actorId, action: 'update', resource: 'media_portal',
        resourceId: mediaItemId, meta: { operation: 'retry_processing' } })
    }
    return { ok: true as const }
  })
}
