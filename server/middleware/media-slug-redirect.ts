import { defineEventHandler, sendRedirect, getRequestURL } from 'h3'
import { and, eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { mediaItems } from '../db/schema'
import { PUBLISHED_MEDIA_STATUS } from '../services/media-portal'

/**
 * Chuyển hướng 301 link video cũ dạng `/media/<slug>` sang `/media/<short_id>`.
 *
 * ## Vì sao tách thành middleware chứ không để trong API endpoint
 *
 * Endpoint `GET /api/public/media/[shortId]` đã có logic tra cả `shortId` lẫn
 * `slug` — nhưng `sendRedirect` trong một API endpoint chỉ đổi URL của **lượt
 * fetch nội bộ** mà `useFetch` theo, không đổi URL trên thanh địa chỉ trình duyệt.
 * Công cụ tìm kiếm gọi `/media/<slug>`, nhận 200, và index lại slug cũ thay vì
 * chuyển thứ hạng sang short_id. Redirect 301 để SEO phải ở **tầng route**, trước
 * khi page render — đúng tiền lệ `legacy-urls.ts`.
 *
 * ## Ranh giới hoạt động
 *
 * Chỉ chạm `/media/<giá trị đơn>` — không chạm `/media/` (danh sách), không chạm
 * `/api/public/media/**` (asset stream/thumb/view đã tự tra cả hai cột, serve
 * thẳng không redirect). Một path có đúng 11 ký tự base64url thì coi là short_id
 * hợp lệ và để page lo; ngược lại -> tra theo `slug` -> tìm thấy thì 301, không
 * thì để page trả 404.
 *
 * ## Giữ query string
 *
 * `?comments=<trang>` cho neo bình luận — mất nó là rơi cạnh bình luận thay vì
 * trúng. Tiếp theo tiền lệ `legacy-urls.ts` giữ nguyên.
 */
const SHORT_ID_RE = /^[A-Za-z0-9-_]{11}$/

export default defineEventHandler(async (event) => {
  const url = getRequestURL(event)
  // Chỉ xử lý đường dẫn trang công khai `/media/<id>`, không chạm `/api/**`.
  if (!url.pathname.startsWith('/media/')) return

  const segments = url.pathname.slice('/media/'.length).split('/')
  // Chỉ nhận đúng một đoạn sau `/media/`: `/media/abc` (chi tiết), không
  // `/media/abc/stream` (asset — đã có endpoint riêng tra cả hai cột).
  if (segments.length !== 1) return
  const segment = segments[0]
  if (!segment) return

  // Đúng 11 ký tự base64url → short_id, để page `[shortId].vue` xử lý.
  if (SHORT_ID_RE.test(segment)) return

  // Có thể là slug cũ → tra DB. Chỉ lấy `shortId`, không cần serialize đầy đủ:
  // lượt này chạy cho **mọi** truy cập `/media/<không-phải-short-id>`, nên phải
  // nhẹ nhất có thể.
  const [row] = await getDb()
    .select({ shortId: mediaItems.shortId })
    .from(mediaItems)
    .where(and(eq(mediaItems.slug, segment), eq(mediaItems.status, PUBLISHED_MEDIA_STATUS)))
    .limit(1)

  if (!row?.shortId) return // Không tìm thấy theo slug → để page trả 404 như cũ.

  const query = url.search
  return sendRedirect(event, `/media/${row.shortId}${query}`, 301)
})
