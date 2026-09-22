/**
 * Hoàn tất một lượt tải lên: ghép các phần, kiểm nội dung, tạo mục media.
 *
 * Service làm đúng thứ tự "rẻ nhất trước, phá huỷ sau cùng": kiểm quyền sở hữu →
 * thiếu phần → ghép → kiểm byte đầu (bốn bước không ghi hàng nào, nên một lượt
 * sai không để lại dấu vết trong `media_items`) → **chỉ khi** tệp ghép được xác
 * nhận là video mới mở transaction tạo hàng `media_items` + dòng `activity_logs`
 * bằng `tx.insert(activityLogs)` bên trong `db.transaction`. Cặp đó nằm trong
 * service, nên endpoint này không có cặp audit để lo.
 *
 * ## Nhánh "đã hoàn tất" trả lại mục đã tạo
 *
 * Lần đầu `completeUpload` tạo hàng và trả `mediaItemId`. Một lượt gọi lại (mạng
 * đứt ở giữa trả lời) sẽ đi vào nhánh `view.status === 'completed'` và trả đúng
 * mục đã tạo thay vì tạo thứ hai. Endpoint không phải tự lo nhánh đó — service
 * đã có.
 *
 * ## Nhánh thay tệp (`replaceMediaItemId`)
 *
 * Body có trường `replaceMediaItemId` → không tạo hàng mới mà cập nhật hàng cũ,
 * giữ slug/tiêu đề/bình luận. Cần quyền `update` trên `media_portal` (thay vì
 * `create`), vì đây là sửa video đã có — ai được sửa video mới được thay tệp.
 */
import { defineEventHandler, readBody, setResponseStatus } from 'h3'

import { requireResourcePermission } from '../../../../../utils/permissions'
import { completeUpload } from '../../../../../services/chunked-upload'
import { resolveMediaConfigWithDb } from '../../../../../services/media-config-service'
import { getDb } from '../../../../../utils/db'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser

  const uploadId = event.context.params?.id

  // Body tuỳ chọn: `replaceMediaItemId` để thay tệp video đã có.
  const body = await readBody(event).catch(() => ({})) as { replaceMediaItemId?: unknown }
  const replaceId = typeof body?.replaceMediaItemId === 'number' && Number.isFinite(body.replaceMediaItemId) && body.replaceMediaItemId > 0
    ? Math.floor(body.replaceMediaItemId) : undefined

  // Nhánh thay tệp cần quyền `update` (sửa video đã có); nhánh tạo mới cần `create`.
  requireResourcePermission(adminUser, 'media_portal', replaceId ? 'update' : 'create')

  const { config } = await resolveMediaConfigWithDb(getDb())

  const result = await completeUpload({
    adminUserId: adminUser.id,
    uploadId,
    ...(replaceId ? { replaceMediaItemId: replaceId } : {}),
  }, { config })

  if (!result.ok) {
    throw createError({ statusCode: result.status, statusMessage: result.message })
  }

  setResponseStatus(event, 201)
  return {
    ok:          true,
    mediaItemId: result.mediaItemId,
    slug:        result.slug,
    contentType: result.contentType,
  }
})
