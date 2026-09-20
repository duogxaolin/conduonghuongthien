/**
 * Ảnh thu nhỏ, phục vụ từ **chính origin của cổng**.
 *
 * Vì sao không trỏ thẳng thẻ `<img>` vào máy chủ ảnh của nền tảng: mỗi lượt tải
 * trang sẽ gửi IP và referrer của người đọc tới một bên thứ ba, trên đúng những
 * trang mà công dân đang tra cứu vị thế pháp lý của chính mình. Đó là cùng lý do
 * dự án tự chủ webfont và không lưu địa chỉ ảnh đại diện Google. Nên máy chủ đi
 * lấy ảnh, còn trình duyệt chỉ nói chuyện với cổng này.
 *
 * Tra theo **slug của mục đã xuất bản**, không theo định danh video. Nếu nhận
 * định danh từ URL thì bất kỳ ai cũng biến endpoint này thành một proxy ảnh mở
 * cho mọi video trên nền tảng — và cái giá là băng thông của cơ quan.
 *
 * Ảnh của mục tự lưu trữ nằm trên đĩa (`<workdir>/media/<slug>/thumb.jpg`) và
 * được truyền thẳng, không đi qua mạng.
 */
import { createReadStream } from 'node:fs'

import { createError, defineEventHandler, getRouterParam, sendStream, setResponseHeaders } from 'h3'

import { resolveMediaConfig } from '../../../../utils/media-config'
import { logWarn } from '../../../../utils/logger'
import { resolveThumbnailTarget } from '../../../../services/media-portal'

/** Ảnh thu nhỏ của nền tảng ngoài: vài chục KB là cùng. Trần này chỉ để một phản
 *  hồi bất thường không kéo cả tệp vào RAM của tiến trình. */
const UPSTREAM_MAX_BYTES = 2 * 1024 * 1024
const UPSTREAM_TIMEOUT_MS = 5000
/** Một ngày. Ảnh thu nhỏ của một video không đổi, nhưng nó thuộc về một mục có
 *  thể bị rút — đệm vĩnh viễn sẽ giữ nó sống trên trình duyệt của người đã xem. */
const THUMBNAIL_CACHE_SECONDS = 86_400

/** Chỉ nhận ảnh. Một `Content-Type` khác nghĩa là thượng nguồn không trả về thứ
 *  ta xin — chuyển tiếp nó nguyên trạng là để một bên thứ ba quyết định kiểu nội
 *  dung trên origin này.
 *
 *  Trả về chính chuỗi đã kiểm (không phải `boolean`) để nơi gọi không phải khẳng
 *  định lại `contentType` là chuỗi — một `!` ở đó là chỗ dễ bị xoá nhất khi có
 *  người dọn dẹp. */
function imageContentTypeOrNull(value: string | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed.toLowerCase().startsWith('image/')) return null
  // Chuỗi này đi thẳng vào một header phản hồi: ký tự xuống dòng trong đó là chèn
  // header, nên nó phải là một kiểu MIME trần, không phải bất cứ thứ gì có `image/`.
  return /^image\/[a-z0-9.+-]+$/.test(trimmed.toLowerCase()) ? trimmed : null
}

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ statusCode: 404 })

  const target = await resolveThumbnailTarget(slug, { config: resolveMediaConfig() })
  if (!target) throw createError({ statusCode: 404 })

  if (target.kind === 'local') {
    setResponseHeaders(event, {
      'Content-Type': target.contentType,
      'Content-Length': String(target.size),
      'Cache-Control': `public, max-age=${THUMBNAIL_CACHE_SECONDS}`,
      'X-Content-Type-Options': 'nosniff',
    })
    return sendStream(event, createReadStream(target.filePath))
  }

  // ── Nguồn ngoài: máy chủ đi lấy, người đọc không bao giờ chạm tới nền tảng ──
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)

  try {
    const upstream = await fetch(target.url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { accept: 'image/*' },
    })

    if (!upstream.ok) {
      logWarn({ event: 'public.media_thumbnail_upstream_failed', status: upstream.status })
      throw createError({ statusCode: 404 })
    }

    const contentType = imageContentTypeOrNull(upstream.headers.get('content-type'))
    if (!contentType) {
      logWarn({ event: 'public.media_thumbnail_upstream_failed', reason: 'not_an_image' })
      throw createError({ statusCode: 404 })
    }

    const body = Buffer.from(await upstream.arrayBuffer())
    if (body.byteLength === 0 || body.byteLength > UPSTREAM_MAX_BYTES) {
      logWarn({ event: 'public.media_thumbnail_upstream_failed', reason: 'unexpected_size' })
      throw createError({ statusCode: 404 })
    }

    setResponseHeaders(event, {
      'Content-Type': contentType,
      'Content-Length': String(body.byteLength),
      'Cache-Control': `public, max-age=${THUMBNAIL_CACHE_SECONDS}`,
      // Không có header này, một ảnh mang nội dung HTML được trình duyệt diễn giải
      // là HTML chạy trên chính origin của cổng.
      'X-Content-Type-Options': 'nosniff',
    })
    return body
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    // Mạng hỏng, hết thời gian, DNS sai — tất cả đọc ra **404**: ảnh thu nhỏ
    // không có. Một 500 ở đây sẽ khiến trình duyệt ghi một dòng lỗi đỏ cho một
    // tấm ảnh thiếu, trong khi trang vẫn dùng được.
    logWarn({
      event: 'public.media_thumbnail_upstream_failed',
      reason: error instanceof Error ? error.name : 'unknown',
    })
    throw createError({ statusCode: 404 })
  } finally {
    clearTimeout(timer)
  }
})
