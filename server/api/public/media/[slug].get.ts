/**
 * Chi tiết một mục media đã xuất bản, tra theo slug.
 *
 * Nháp, đã lưu trữ và slug không tồn tại **dùng chung một phản hồi 404**. Ba
 * phản hồi khác nhau là ba cách nói cho người ngoài biết slug nào có thật — và
 * một slug chưa xuất bản vẫn là thông tin nội bộ của cơ quan.
 *
 * Mọi thứ khác cũng phải giống nhau: cùng thời gian xử lý, cùng hình dạng thân
 * bài. Một nhánh trả nhanh hơn vì "không tìm thấy nên không phải nạp gì thêm"
 * là một kênh rò rỉ thời gian, nên cả hai nhánh đi qua **cùng một truy vấn**.
 */
import { createError, defineEventHandler, getRouterParam } from 'h3'

import { logError } from '../../../utils/logger'
import { getPublishedMediaBySlug } from '../../../services/media-portal'

const NOT_FOUND_MESSAGE = 'Video không tồn tại hoặc chưa được đăng.'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) {
    throw createError({ statusCode: 404, statusMessage: NOT_FOUND_MESSAGE })
  }

  try {
    const item = await getPublishedMediaBySlug(slug)
    if (!item) {
      throw createError({ statusCode: 404, statusMessage: NOT_FOUND_MESSAGE })
    }
    return { ok: true, item }
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
