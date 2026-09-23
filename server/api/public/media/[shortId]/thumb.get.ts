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
import { readFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { createError, defineEventHandler, getRouterParam, sendStream, setResponseHeaders, type H3Event } from 'h3'

import { logWarn } from '../../../../utils/logger'
import { resolveStreamTarget, resolveThumbnailTarget, MEDIA_STREAM_MANIFEST_PATH } from '../../../../services/media-portal'
import { resolveMediaConfigWithDb } from '../../../../services/media-config-service'
import { getDb } from '../../../../utils/db'
import { streamR2Object } from '../../../../services/video-r2-sync'
import { extractThumbnailOnDemand } from '../../../../services/video-processing'

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
  const shortId = getRouterParam(event, 'shortId')
  if (!shortId) throw createError({ statusCode: 404 })

  const { config } = await resolveMediaConfigWithDb(getDb())
  let target = await resolveThumbnailTarget(shortId, { config })

  // Link cũ dùng slug: short_id tra không ra → thử slug. Asset phục vụ thẳng,
  // không redirect.
  if (!target) {
    target = await resolveThumbnailTarget(shortId, { config, lookupSlug: true })
  }

  if (!target) {
    // ── Fallback: không có thumb tĩnh ở R2 hay đĩa → trích một khung hình từ
    // chính tệp gốc lúc phục vụ. Đây là ý "video không có thumbnail thì tự cắt
    // đoạn làm thumbnail". Pipeline upload vốn đã trích thumb (giai đoạn 5 của
    // `processMediaItem`), nhưng nếu lượt đó fail im lặng hoặc item cũ chưa từng
    // qua pipeline thì thumb vắng — công dân thấy một ô ảnh trống trên danh sách
    // trong khi video vốn phát được. Trích at-the-fly tốn một lượt FFmpeg, nhưng
    // cache header 1 ngày nên mỗi khách đầu tiên trả giá một lần, còn lại báo đáp.
    //
    // Chỉ hoạt động cho `source='upload'` (video tự lưu trữ). YouTube dùng nhánh
    // `remote` ở trên (đã return nếu có thumb, không đến đây).
    const frame = await extractFallbackFrame(shortId, config)
    if (frame) {
      setResponseHeaders(event, {
        'Content-Type': 'image/jpeg',
        'Content-Length': String(frame.byteLength),
        // Cache ngắn hơn thumb tĩnh — thumb at-the-fly có thể đổi khi pipeline
        // chạy lại, và 1 ngày là quá dài cho một frame dự phòng.
        'Cache-Control': `public, max-age=${FALLBACK_FRAME_CACHE_SECONDS}`,
        'X-Content-Type-Options': 'nosniff',
      })
      return frame
    }
    // Fallback frame cũng fail (FFmpeg lỗi, hoặc không phải passthrough local) →
    // placeholder. Một 404 ở đây vỡ ô ảnh trên trang công dân.
    return servePlaceholder(event)
  }

  if (target.kind === 'local') {
    setResponseHeaders(event, {
      'Content-Type': target.contentType,
      'Content-Length': String(target.size),
      'Cache-Control': `public, max-age=${THUMBNAIL_CACHE_SECONDS}`,
      'X-Content-Type-Options': 'nosniff',
    })
    return sendStream(event, createReadStream(target.filePath))
  }

  // ── R2: thumbnail nằm cùng cây R2 với rendition. Pipe qua proxy, không redirect ──
  if (target.kind === 'r2') {
    const r2Config = config.videoStorage.r2
    if (!r2Config) throw createError({ statusCode: 503, statusMessage: 'R2 chưa cấu hình.' })
    try {
      const obj = await streamR2Object(target.r2Key, r2Config)
      setResponseHeaders(event, {
        'Content-Type': obj.contentType,
        'Content-Length': String(obj.contentLength),
        'Cache-Control': `public, max-age=${THUMBNAIL_CACHE_SECONDS}`,
        'X-Content-Type-Options': 'nosniff',
      })
      return sendStream(event, obj.stream)
    } catch {
      logWarn({ event: 'public.media_thumbnail_r2_miss', shortId, key: target.r2Key })
      throw createError({ statusCode: 404 })
    }
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
      // Video YouTube bị gỡ/restricted → upstream 404. Trả placeholder thay vì
      // 404: một ô ảnh vỡ trên trang công dân đọc ra "cổng hỏng".
      logWarn({ event: 'public.media_thumbnail_upstream_failed', status: upstream.status })
      return servePlaceholder(event)
    }

    const contentType = imageContentTypeOrNull(upstream.headers.get('content-type'))
    if (!contentType) {
      logWarn({ event: 'public.media_thumbnail_upstream_failed', reason: 'not_an_image' })
      return servePlaceholder(event)
    }

    const body = Buffer.from(await upstream.arrayBuffer())
    if (body.byteLength === 0 || body.byteLength > UPSTREAM_MAX_BYTES) {
      logWarn({ event: 'public.media_thumbnail_upstream_failed', reason: 'unexpected_size' })
      return servePlaceholder(event)
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

/** Cache ngắn hơn thumb tĩnh — frame dự phòng có thể đổi khi pipeline chạy lại. */
const FALLBACK_FRAME_CACHE_SECONDS = 300 // 5 phút
/** Ảnh mặc định khi thượng nguồn trả 404 (video YouTube bị gỡ/restricted). Cache
 *  dài vì placeholder không đổi, nhưng không vĩnh viễn — video có thể được khôi
 *  phục trên nền tảng, và lượt nạp lại sẽ thử upstream trước. */
const PLACEHOLDER_CACHE_SECONDS = 3600 // 1 giờ

/**
 * Phục vụ ảnh placeholder tĩnh khi thumbnail thật không có — video YouTube bị
 * gỡ/restricted (upstream 404), hoặc mục upload chưa qua pipeline và fallback
 * frame cũng fail. Trả SVG nội tuyến thay vì 404: một ô ảnh vỡ trên trang công
 * dân đọc ra "cổng bị hỏng", trong khi thực tế chỉ là một video không có thumbnail.
 */
function servePlaceholder(event: H3Event) {
  setResponseHeaders(event, {
    'Content-Type': 'image/svg+xml',
    'Cache-Control': `public, max-age=${PLACEHOLDER_CACHE_SECONDS}`,
    'X-Content-Type-Options': 'nosniff',
  })
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360" role="img" aria-label="Không có ảnh đại diện">
  <rect width="640" height="360" fill="#E8EFE5"/>
  <g fill="#9DB39A" transform="translate(280 130)">
    <rect width="80" height="60" rx="6"/>
    <circle cx="22" cy="20" r="7" fill="#E8EFE5"/>
    <path d="M12 52 L34 34 L48 44 L62 28 L68 52 Z" fill="#E8EFE5"/>
  </g>
  <text x="320" y="225" text-anchor="middle" font-family="system-ui, sans-serif" font-size="16" font-weight="600" fill="#6B7D68">Không có ảnh đại diện</text>
</svg>`
}

/**
 * Trích một khung hình từ tệp gốc làm ảnh đại diện dự phòng.
 *
 * Dùng `resolveStreamTarget` với manifest path để tái dùng logic passthrough —
 * nó biết original ở R2 hay đĩa (kèm fallback local khi R2 thiếu original). Chỉ
 * nhận StreamTarget `kind:'local'` + `passthrough:true`: trích từ R2 sẽ cần tải
 * 60MB về tmp chỉ để lấy 1 frame, không đáng — R2 đã có thumb list rộng ở
 * `resolveThumbnailTarget`, nếu vẫn null thì chấp nhận 404.
 *
 * Trả buffer JPEG hoặc `null` (FFmpeg fail, hoặc không phải passthrough local).
 * Tệp tmp dọn trong `finally` — một lỗi giữa chừng không để lại rác.
 */
async function extractFallbackFrame(
  shortId: string,
  config: Awaited<ReturnType<typeof resolveMediaConfigWithDb>>['config'],
): Promise<Buffer | null> {
  let streamTarget = await resolveStreamTarget(shortId, MEDIA_STREAM_MANIFEST_PATH, { config })
  // Link cũ dùng slug: thử lại với slug nếu short_id tra không ra.
  if (!streamTarget) {
    streamTarget = await resolveStreamTarget(shortId, MEDIA_STREAM_MANIFEST_PATH, { config, lookupSlug: true })
  }
  if (!streamTarget || streamTarget.kind !== 'local' || !streamTarget.passthrough) return null

  // Lưu thumb cạnh `original.<ext>` (cấp gốc directory) để lần sau `resolveThumbnailTarget`
  // tìm thấy tĩnh — tránh spawn FFmpeg mỗi lượt. Extract thẳng vào đích (không qua
  // tmpDir) vì FFmpeg ghi atomic-enough cho một tệp JPEG nhỏ, và nếu gián đoạn giữa
  // chừng thì `resolveThumbnailTarget` lần sau thấy tệp không hợp lệ và lại fallback.
  // Tệp đích đã tồn tại (race hai khách) thì FFmpeg `-y` đè — cùng nội dung.
  const targetDir = dirname(streamTarget.filePath)
  const outPath = join(targetDir, 'thumb.jpg')
  try {
    await mkdir(targetDir, { recursive: true })
    const ok = await extractThumbnailOnDemand(streamTarget.filePath, outPath)
    if (!ok) {
      logWarn({ event: 'public.media_thumbnail_fallback_failed', shortId })
      return null
    }
    return await readFile(outPath)
  } catch {
    return null
  }
}
