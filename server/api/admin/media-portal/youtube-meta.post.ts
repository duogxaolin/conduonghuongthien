/**
 * Lấy metadata YouTube (tiêu đề, thumbnail, tác giả) qua oEmbed — không cần API
 * key, hợp法 (Google hỗ trợ chính thức), trái ngược với y2mate (vi phạm ToS).
 *
 * ## Vì sao endpoint này tồn tại
 *
 * Form `/admin/media-portal/external` chỉ có ô text nhập link YouTube. Cán bộ dán
 * link vào xong phải tự gõ tiêu đề/mô tả tay — việc máy nên làm. oEmbed cho phép
 * lấy title + thumbnail + author không cần credentials.
 *
 * ## Vì sao không fetch ở client
 *
 * CORS. `www.youtube.com/oembed` không gửi `Access-Control-Allow-Origin`, nên
 * `fetch` từ trình duyệt bị chặn. Phải server-side.
 *
 * ## Trả về
 *
 * `{ ok: true, title, authorName, thumbnailUrl, videoId }` — `videoId` đã bóc để
 * form điền lại vào ô `youtubeVideoId` (chuẩn hoá thẳng từ URL sang ID, tránh cán
 * bộ phải paste lại).
 *
 * Lỗi trả `{ ok: false, reason: 'invalid' | 'fetch_failed' }` chứ không ném 400 —
 * cùng tiền lệ thumb endpoint: input do cán bộ dán, trả câu trả lời rõ ràng hơn
 * là ném một lỗi chung chung.
 *
 * ## Không lưu metadata vào CSDL
 *
 * Metadata chỉ là trợ giúp nhập liệu. Khi submit, `title` đi cùng form. Thumb
 * công khai luôn qua proxy `/api/public/media/<slug>/thumb` (xem
 * `serializePublicMedia` — `hasThumbnail` dựa trên `embedUrl !== null`, không đọc
 * `thumbnail_url` đã lưu). Vậy endpoint này không chạm CSDL.
 */
import { defineEventHandler, readBody } from 'h3'

import { requireResourcePermission } from '../../../utils/permissions'
import { extractYouTubeVideoId } from '../../../utils/youtube-parser'
import { logWarn } from '../../../utils/logger'

const OEMBED_TIMEOUT_MS = 5000

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'media_portal', 'create')

  const body = await readBody(event).catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, reason: 'invalid' as const }
  }

  const fields = body as Record<string, unknown>
  const raw = typeof fields.url === 'string' ? fields.url : (typeof fields.youtubeVideoId === 'string' ? fields.youtubeVideoId : '')
  const videoId = extractYouTubeVideoId(raw)
  if (!videoId) {
    return { ok: false, reason: 'invalid' as const }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), OEMBED_TIMEOUT_MS)

  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
    const res = await fetch(oembedUrl, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    })

    if (!res.ok) {
      logWarn({ event: 'media.youtube_meta_failed', status: res.status, videoId })
      return { ok: false, reason: 'fetch_failed' as const }
    }

    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.includes('application/json')) {
      logWarn({ event: 'media.youtube_meta_failed', reason: 'not_json', contentType })
      return { ok: false, reason: 'fetch_failed' as const }
    }

    const data = await res.json().catch(() => null)
    if (!data || typeof data !== 'object') {
      return { ok: false, reason: 'fetch_failed' as const }
    }

    const o = data as Record<string, unknown>
    const title = typeof o.title === 'string' ? o.title.slice(0, 512) : ''
    const authorName = typeof o.author_name === 'string' ? o.author_name : ''
    const thumbnailUrl = typeof o.thumbnail_url === 'string' ? o.thumbnail_url : ''

    if (!title || !thumbnailUrl) {
      return { ok: false, reason: 'fetch_failed' as const }
    }

    return {
      ok: true as const,
      title,
      authorName,
      thumbnailUrl,
      videoId,
    }
  } catch (error) {
    logWarn({
      event: 'media.youtube_meta_failed',
      reason: error instanceof Error ? error.name : 'unknown',
    })
    return { ok: false, reason: 'fetch_failed' as const }
  } finally {
    clearTimeout(timer)
  }
})
