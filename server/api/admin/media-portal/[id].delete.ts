/**
 * Xoá một mục media.
 *
 * `deleteMediaItem` đã bọc hàng + audit trong `db.transaction` — endpoint chỉ
 * truyền id và `actorId` xuống. Trả `false` nghĩa là mục không tồn tại, đọc là
 * 404 chứ không phải 200 kèm `ok: false`: một 200 mang op-không-thành-công là hợp
 * đồng khó dùng, và lượt xoá là một lệnh một-shot — component không có "thử
 * lại" cho một hàng đã biến mất.
 *
 * Tệp trên đĩa **không** bị xoá ở đây: rollback một `unlink` là không lấy lại
 * được, nên gói nó vào giao dịch chỉ tạo ra trạng thái tệ hơn (hàng còn mà tệp
 * biến mất). Dọn tệp mồ côi là việc của vận hành. Xem docstring của
 * `deleteMediaItem` về ranh giới này.
 */
import { defineEventHandler } from 'h3'

import { requireResourcePermission } from '../../../utils/permissions'
import { deleteMediaItem } from '../../../services/media-portal'
import { purgePublicPageCacheAfterWrite } from '../../../utils/public-page-cache'
import { bumpAnswerCacheVersion } from '../../../services/chatbot-answer-cache'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'media_portal', 'delete')

  const id = Number(event.context.params?.id)
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Mục media không hợp lệ.' })
  }

  const result = await deleteMediaItem({ id: Math.floor(id), actorId: adminUser.id })
  if (!result.removed) {
    throw createError({ statusCode: 404, statusMessage: 'Mục media không tồn tại.' })
  }

  // Chỉ xoá bộ đệm trang công khai nếu mục xoá đang `published` — mục `draft`/`archived`
  // không hiện ở đâu cả. Sau commit, nuốt lỗi (chỉ log). Bản cũ chỉ lọc khoá dạng
  // `nitro/routes:/media:GET.json`, hình dạng Nitro không bao giờ sinh ra (khoá thật:
  // `nitro:routes:_:media.<hash>.json`), nên chưa từng xoá được gì — giờ dùng chung
  // `purgePublicPageCacheAfterWrite` (`server/utils/public-page-cache.ts`).
  if (result.fromStatus === 'published') await purgePublicPageCacheAfterWrite('media_portal.delete')

  // Câu trả lời chatbot đã cache không được dẫn video vừa xoá (`search_c11_videos`).
  await bumpAnswerCacheVersion().catch(() => undefined)
  return { ok: true }
})
