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
import { resolveMediaConfigWithDb } from '../../../../services/media-config-service'
import { getDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'media_portal', 'update')

  const id = Number(event.context.params?.id)
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Mục media không hợp lệ.' })
  }

  const { config } = await resolveMediaConfigWithDb(getDb())

  const result = await clearMediaThumbnail({ id, actorId: adminUser.id, config }, { db: getDb() })

  if (!result.ok) {
    const statusMessage = result.reason === 'not_found'
      ? 'Mục media không tồn tại.'
      : result.reason === 'not_upload'
        ? 'Chỉ video tự tải lên mới đổi thumbnail được.'
        : 'Không xoá được thumbnail.'
    throw createError({ statusCode: 404, statusMessage })
  }

  return { ok: true }
})
