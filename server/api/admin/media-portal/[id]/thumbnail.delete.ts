/**
 * Xoá thumbnail custom của một mục video — về thumb tự sinh (pipeline hoặc
 * fallback frame).
 *
 * Xoá `thumb.jpg` cấp gốc ở đĩa + R2, reset `thumbnail_url`. Sau khi xoá,
 * `resolveThumbnailTarget` lùi về `generations/<claim>/thumb.jpg` (nếu pipeline
 * đã trích) hoặc `extractFallbackFrame` (nếu vắng). Xem `clearMediaThumbnail`
 * trong service cho logic đầy đủ.
 *
 * Quyền: `media_portal.update`.
 */
import { createError, defineEventHandler } from 'h3'

import { requireResourcePermission } from '../../../../utils/permissions'
import { clearMediaThumbnail } from '../../../../services/media-portal'
import { resolveAdminMediaConfig } from '../../../../services/admin-media-config'
import { bumpAnswerCacheVersion } from '../../../../services/chatbot-answer-cache'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'media_portal', 'update')

  const id = Number(event.context.params?.id)
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Mục media không hợp lệ.' })
  }

  const { config } = await resolveAdminMediaConfig()

  // No `deps`: the service falls back to the shared handle itself (its `deps.db` default).
  const result = await clearMediaThumbnail({ id, actorId: adminUser.id, config })

  if (!result.ok) {
    const statusMessage = result.reason === 'not_found'
      ? 'Mục media không tồn tại.'
      : result.reason === 'not_upload'
        ? 'Chỉ video tự tải lên mới đổi thumbnail được.'
        : 'Không xoá được thumbnail.'
    throw createError({ statusCode: 404, statusMessage })
  }

  // `search_c11_videos` trả ảnh đại diện cho model: câu đã cache không được dẫn ảnh cũ (đã dọn).
  await bumpAnswerCacheVersion().catch(() => undefined)
  return { ok: true }
})
