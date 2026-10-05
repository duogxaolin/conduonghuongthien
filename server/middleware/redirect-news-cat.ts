import { defineEventHandler, sendRedirect, getRequestURL } from 'h3'

/**
 * Chuyển hướng 301 link category cũ dạng `/<type>?cat=<slug>` sang path segment
 * `/<type>/<slug>` — bảo backlinks đã index Google và link chia sẻ external.
 *
 * Sai số tiền lệ `legacy-urls.ts` + `media-slug-redirect.ts`: redirect 301 phải
 * ở tầng route, trước khi page render, để công cụ tìm kiếm chuyển thứ hạng sang
 * địa chỉ mới.
 *
 * Chỉ chạm path 1-segment (không chứa `/`) có query `cat` không rỗng. Path
 * 2-segment (`/<type>/<cat>` đã là path segment) và path `/` (home) đi tiếp.
 * Giữ query `?page` nếu có — `?cat=tin-noi-bat&page=2` → `/news/tin-noi-bat?page=2`.
 *
 * Không verify type có thật (v.d. `/news`, `/video-tuyen-truyen`) — chỉ cần path
 * 1-segment + có `cat` → redirect. Nếu type không tồn tại, page list sẽ 404 sau
 * redirect (đúng behavior).
 */
export default defineEventHandler((event) => {
  const url = getRequestURL(event)
  const { pathname, searchParams } = url

  // Chỉ path 1-segment (không có `/` ở giữa, không phải `/` root).
  if (pathname.includes('/', 1)) return
  if (pathname === '/' || pathname === '') return

  const cat = searchParams.get('cat')
  if (!cat) return

  // Target path: /<type>/<cat>. pathname đã có leading slash (`/news`).
  // Giữ query ngoài cat (page, q...).
  const remaining = new URLSearchParams(searchParams)
  remaining.delete('cat')
  const query = remaining.toString()
  const target = query ? `${pathname}/${cat}?${query}` : `${pathname}/${cat}`
  return sendRedirect(event, target, 301)
})
