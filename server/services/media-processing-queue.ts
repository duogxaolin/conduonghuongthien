import { eq } from 'drizzle-orm'
import { getDb, type Database } from '../utils/db'
import { activityLogs, mediaItems } from '../db/schema'

/**
 * Đưa một mục vào hàng chờ chuyển mã. Ba nhách theo trạng thái hiện tại, và phân
 * biệt đó là tạo mới / thử lại sau lỗi / xử lý lại từ đầu — không phải tuỳ chọn:
 *
 *   • `pending`  — chưa chạy hoặc đang chờ, không reset gì, chỉ dispatch.
 *   • `failed`  — thử lại sau lỗi: reset ngân sách thử (`processingAttempts=0`),
 *     xoá `processingError`, giữ `resolutionsReady` (các bản đã xong vẫn dùng được).
 *     Audit `operation: 'retry_processing'`.
 *   • `ready`   — xử lý lại từ đầu: reset `resolutionsReady=[]` (pipeline sẽ công
 *     bố lại), `processingError=null`, `claimedBy=null`. Audit `operation: 'reprocess'`.
 *     `storagePath` giữ nguyên — pipeline sẽ ghi đè rendition mới lên cùng cây.
 *   • `processing` — từ chối (409): đang chạy, không cho trigger bản thứ hai tranh
 *     nhau claim.
 *
 * `for('update')` khoá hàng để hai lượt gọi đồng thời không cùng thấy `ready` và
 * cùng reset.
 */
export async function enqueueMediaProcessing(mediaItemId: number, actorId: number, db: Database = getDb()) {
  return db.transaction(async tx => {
    const [item] = await tx.select().from(mediaItems).where(eq(mediaItems.id, mediaItemId)).limit(1).for('update')
    if (!item) return { ok: false as const, status: 404, message: 'Không tìm thấy mục media này.' }
    if (item.source !== 'upload') return { ok: false as const, status: 400, message: 'Chỉ mục tự lưu trữ mới cần chuyển mã.' }

    if (item.processingStatus === 'processing') {
      return { ok: false as const, status: 409, message: 'Video đang được xử lý. Vui lòng đợi hoàn tất.' }
    }

    if (item.processingStatus === 'failed') {
      await tx.update(mediaItems).set({ processingStatus: 'pending', processingAttempts: 0,
        processingNextAttemptAt: null, processingHeartbeatAt: null, claimedBy: null, processingError: null,
      }).where(eq(mediaItems.id, mediaItemId))
      await tx.insert(activityLogs).values({ userId: actorId, action: 'update', resource: 'media_portal',
        resourceId: mediaItemId, meta: { operation: 'retry_processing' } })
    } else if (item.processingStatus === 'ready') {
      // Xử lý lại từ đầu — xoá rendition đã có, pipeline sẽ công bố lại. Giữ
      // `storagePath` và `thumbnailUrl`: rendition mới ghi đè cùng vị trí, và
      // thumbnail cũ vẫn hợp lệ cho tới khi extractThumbnail ghi cái mới.
      await tx.update(mediaItems).set({ processingStatus: 'pending', processingAttempts: 0,
        processingNextAttemptAt: null, processingHeartbeatAt: null, claimedBy: null, processingError: null,
        resolutionsReady: [],
      }).where(eq(mediaItems.id, mediaItemId))
      await tx.insert(activityLogs).values({ userId: actorId, action: 'update', resource: 'media_portal',
        resourceId: mediaItemId, meta: { operation: 'reprocess' } })
    }
    // `pending` — không cần reset, chỉ dispatch.
    return { ok: true as const }
  })
}
