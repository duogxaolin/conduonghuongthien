/**
 * Khởi động (hoặc khởi động lại) chuyển mã cho một mục media đã tải lên.
 *
 * Pipeline `processMediaItem` chạy FFmpeg trong vài phút, nên endpoint này **bắn
 * rồi quên**: trả 202 ngay, không `await` kết quả. Người tải lên theo dõi tiến
 * trình qua `GET /api/admin/media-portal/[id]` — `processingStatus` đi từ
 * `pending` → `processing` → `ready` (hoặc `failed` kèm `processingError`).
 *
 * Manual retries of failed rows reset the retry budget and record an audit
 * entry in one transaction. Busy admission leaves the persisted pending row
 * for the scheduler. Missing items and external sources are rejected before 202.
 */
import { defineEventHandler, readBody, setResponseStatus } from 'h3'

import { requireResourcePermission } from '../../../../utils/permissions'
import { processMediaItem } from '../../../../services/video-processing'
import { enqueueMediaProcessing } from '../../../../services/media-processing-queue'
import { logWarn } from '../../../../utils/logger'
import { resolveMediaConfigWithDb } from '../../../../services/media-config-service'
import { getDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'media_portal', 'update')

  const id = Number(event.context.params?.id)
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Mục media không hợp lệ.' })
  }

  // Body không bắt buộc — endpoint chỉ cần `id` trên đường dẫn. Đọc để client có
  // thể gửi gì đó mà không bị từ chối.
  await readBody(event).catch(() => ({}))

  const mediaItemId = Math.floor(id)
  const enqueued = await enqueueMediaProcessing(mediaItemId, adminUser.id)
  if (!enqueued.ok) throw createError({ statusCode: enqueued.status, statusMessage: enqueued.message })

  // Bắn rồi quên. Lượt chuyển mã chạy chậm; `processMediaItem` tự ghi trạng thái
  // vào `media_items` (`processingStatus`, `resolutions_ready`, `claimed_by`,
  // `updated_at`) nên giao diện theo dõi qua lượt thăm dò trạng thái. `.catch` là
  // bắt buộc: một promise rời tay không được bắt sẽ ném unhandled rejection và
  // hạ worker. Lỗi đã nằm trong `processingError` trên hàng — `logWarn` đây chỉ
  // cho những throw bất ngờ vượt qua phần xử lý nội bộ.
  const { config } = await resolveMediaConfigWithDb(getDb())
  void processMediaItem({ mediaItemId }, { config })
    .catch((err) => {
      logWarn({
        event:       'media.transcode_failed',
        mediaItemId,
        message:     err instanceof Error ? err.message : String(err),
      })
    })

  setResponseStatus(event, 202)
  return { ok: true, message: 'Đã đưa mục vào hàng chờ chuyển mã.' }
})
