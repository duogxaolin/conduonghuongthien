import { defineEventHandler, sendRedirect, getRequestURL } from 'h3'
import { resolveLegacyUrl } from '../utils/legacy-urls'

/**
 * Chuyển hướng 301 địa chỉ cổng cũ (ASP.NET) sang cổng mới — xem
 * `server/utils/legacy-urls.ts` cho bảng đích và lý do từng dòng.
 *
 * Chỉ chạm các đường khớp bảng chuyển hướng; mọi pathname khác đi tiếp như chưa
 * có middleware này (`return` là bắt buộc — h3 dừng chuỗi middleware ở đó, thiếu
 * return thì phản hồi 301 bị ghi đè bởi handler kế tiếp). 301 (không phải 302)
 * để công cụ tìm kiếm chuyển hẳn thứ hạng sang địa chỉ mới.
 */
export default defineEventHandler((event) => {
  const { pathname } = getRequestURL(event)
  const target = resolveLegacyUrl(pathname)
  if (target) return sendRedirect(event, target, 301)
})
