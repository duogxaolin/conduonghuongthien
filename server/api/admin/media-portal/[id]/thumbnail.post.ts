/**
 * Đặt ảnh thumbnail cho một mục video từ Thư viện Media.
 *
 * Cán bộ chọn ảnh ở `/admin/media-portal/[id]` (qua `MediaLibraryModal`), endpoint
 * này copy bytes ảnh đó vào `thumb.jpg` cấp gốc của mục — để `resolveThumbnailTarget`
 * tìm thấy tĩnh ở cả R2 lẫn local. Xem `setMediaThumbnail` trong service cho logic
 * đầy đủ (tối ưu sharp, ghi đĩa + R2, audit trong transaction).
 *
 * Quyền: `media_portal.update` — cùng quyền sửa video, không thêm resource mới.
 */
import { createError, defineEventHandler, readBody } from 'h3'

import { requireResourcePermission } from '../../../../utils/permissions'
import { setMediaThumbnail } from '../../../../services/media-portal'
import { resolveMediaConfigWithDb } from '../../../../services/media-config-service'
import { getDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'media_portal', 'update')

  const id = Number(event.context.params?.id)
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Mục media không hợp lệ.' })
  }

  const body = await readBody(event).catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Dữ liệu không hợp lệ.' })
  }
  const mediaId = Number((body as { mediaId?: unknown }).mediaId)
  if (!Number.isSafeInteger(mediaId) || mediaId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Ảnh thư viện không hợp lệ.' })
  }

  const { config } = await resolveMediaConfigWithDb(getDb())

  const result = await setMediaThumbnail(
    { id, mediaId, actorId: adminUser.id, config },
    { db: getDb() },
  ).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Không đặt được thumbnail.'
    throw createError({ statusCode: 500, statusMessage: message })
  })

  if (!result.ok) {
    const statusMessage = result.reason === 'not_found'
      ? 'Mục media không tồn tại.'
      : result.reason === 'media_not_found'
        ? 'Ảnh thư viện không tồn tại.'
        : result.reason === 'not_an_image'
          ? 'Tệp đã chọn không phải ảnh.'
          : result.reason === 'not_upload'
            ? 'Chỉ video tự tải lên mới đổi thumbnail được.'
            : 'Không đặt được thumbnail.'
    throw createError({ statusCode: 404, statusMessage })
  }

  return { ok: true }
})
