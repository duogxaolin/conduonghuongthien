/**
 * Redirect HTTP → HTTPS ở tầng app — chỉ production.
 *
 * Sau proxy/nginx: request tới app luôn là HTTP nội bộ (loopback), nên app không
 * thể đoán scheme từ socket. Tin `x-forwarded-proto` (do nginx/CF set) để biết
 * client thấy http hay https. Chỉ redirect khi client thực sự dùng http — tránh
 * redirect lặp với request nội bộ.
 *
 * `NODE_ENV=production` gate: dev local không có header `x-forwarded-proto` nên
 * middleware return sớm an toàn; production qua proxy/nginx/CF có header → redirect.
 * Gate tường minh để dev Test agent không bị redirect khi `x-forwarded-proto`
 * gửi nhầm, và để đọc code biết ngay middleware này không chạy ở dev.
 *
 * Không `sendRedirect` cho asset/API: chỉ redirect HTML page (text/html). API
 * client (curl, fetch) nên nhận lỗi rõ ràng hơn là redirect âm thầm.
 */
export default defineEventHandler((event) => {
  if (process.env.NODE_ENV !== 'production') return

  const proto = getRequestHeader(event, 'x-forwarded-proto')
  if (proto !== 'http') return

  // Chỉ redirect document navigation, không redirect asset/API (tránh lặp, tránh
  // phá fetch client). Accept: text/html hoặc request không có Accept header.
  const accept = getRequestHeader(event, 'accept') || ''
  if (!accept.includes('text/html') && accept !== '') return

  const host = getRequestHeader(event, 'x-forwarded-host') || getRequestHeader(event, 'host')
  if (!host) return

  const url = getRequestURL(event)
  sendRedirect(event, `https://${host}${url.pathname}${url.search}`, 301)
})
