/**
 * Chi tiết một mục media đã xuất bản, tra theo short_id (định danh URL công khai).
 *
 * Nháp, đã lưu trữ và short_id không tồn tại **dùng chung một phản hồi 404**. Ba
 * phản hồi khác nhau là ba cách nói cho người ngoài biết id nào có thật — và một
 * id chưa xuất bản vẫn là thông tin nội bộ của cơ quan.
 *
 * Mọi thứ else cũng phải giống nhau: cùng thời gian xử lý, cùng hình dạng thân
 * bài. Một nhánh trả nhanh hơn vì "không tìm thấy nên không phải nạp gì thêm"
 * là một kênh rò rỉ thời gian, nên cả hai nhánh đi qua **cùng một truy vấn**.
 *
 * ## Redirect 301 cho link cũ dùng slug
 *
 * URL trang chi tiết từng dùng slug dài (`/media/<slug>`). Nay dùng short_id
 * (`/media/<short_id>`). Link cũ đã chia sẻ / đã index không được chết: khi
 * `shortId` tra không ra, thử `slug` — nếu tìm thấy, **redirect 301** sang
 * `/media/<short_id>`. RedirectPermanent giữ query string (`?comments=` cho
 * trang bình luận), nên một link cũ tới trang 3 của luồng bình luận vẫn mở đúng.
 */
import { and, eq } from 'drizzle-orm'
import { createError, defineEventHandler, getRouterParam, getQuery, sendRedirect } from 'h3'

import { getDb } from '../../../utils/db'
import { mediaItems } from '../../../db/schema'
import { logError } from '../../../utils/logger'
import { getPublishedMediaByShortId, PUBLISHED_MEDIA_STATUS } from '../../../services/media-portal'

const NOT_FOUND_MESSAGE = 'Video không tồn tại hoặc chưa được đăng.'

export default defineEventHandler(async (event) => {
  const shortId = getRouterParam(event, 'shortId')
  if (!shortId) {
    throw createError({ statusCode: 404, statusMessage: NOT_FOUND_MESSAGE })
  }

  try {
    // Thử short_id trước (fast path — index unique, 11 ký tự).
    const item = await getPublishedMediaByShortId(shortId)
    if (item) {
      return { ok: true, item }
    }

    // Không tìm thấy theo short_id → thử slug cũ (link đã phát ra trước đổi).
    // Tìm thấy → redirect 301 sang URL short_id mới, giữ query string.
    const [legacy] = await getDb()
      .select({ shortId: mediaItems.shortId })
      .from(mediaItems)
      .where(and(eq(mediaItems.slug, shortId), eq(mediaItems.status, PUBLISHED_MEDIA_STATUS)))
      .limit(1)

    if (legacy) {
      const query = getQuery(event)
      const qs = Object.keys(query).length
        ? `?${new URLSearchParams(query as Record<string, string>).toString()}`
        : ''
      return sendRedirect(event, `/media/${legacy.shortId}${qs}`, 301)
    }

    throw createError({ statusCode: 404, statusMessage: NOT_FOUND_MESSAGE })
  } catch (error) {
    // `createError` ở trên là một ngoại lệ có chủ đích; bắt lại rồi ném tiếp để
    // một lượt truy vấn hỏng vẫn ra **500**, không bị nuốt thành 404. Nuốt ở đây
    // sẽ biến "cơ sở dữ liệu đang hỏng" thành "video không tồn tại" — và người
    // vận hành sẽ đi tìm một hàng vẫn còn nguyên.
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    logError({
      event: 'public.media_detail_failed',
      message: error instanceof Error ? error.message : String(error),
    })
    throw createError({ statusCode: 500, statusMessage: 'Không thể tải video.' })
  }
})
