/**
 * Phản hồi LỖI máy chủ (≥ 500) không bao giờ được quảng cáo là đệm được.
 *
 * Lỗi đã gặp (đo trên bản build chạy không có CSDL): `/`, `/about`, `/contact`, `/media`
 * trả đúng 503 (trang tự đặt — `app/utils/ssr-failure-response.ts`) nhưng VẪN mang
 * `Cache-Control: s-maxage=60, stale-while-revalidate`. Bộ bọc `swr` của Nitro
 * (`nitropack/dist/runtime/internal/cache.mjs`, `defineCachedEventHandler`) GHI ĐÈ
 * `cache-control` bằng giá trị của routeRule sau khi trang dựng xong, bất kể mã
 * trạng thái. Nitro tự nó không lưu mục có mã ≥ 400 (`validate`), nhưng tiêu đề đó
 * mời Cloudflare/trình duyệt giữ trang lỗi tới 60 giây (và phát lại "stale").
 *
 * Quyết định là hàm thuần (mã trạng thái, đường dẫn) → giá trị tiêu đề hoặc `null`;
 * `server/plugins/error-no-store.ts` áp nó ở hook `beforeResponse` — chạy SAU bộ bọc
 * swr đã đặt tiêu đề, TRƯỚC khi thân phản hồi được ghi.
 *
 * Bỏ qua `/_nuxt/` (tài nguyên build, tệp tĩnh không đi qua đây khi có) và `/_ipx/`
 * (đã có routeRule `no-store` riêng cho lỗi, ảnh 200 do IPX tự đặt `max-age`).
 * Ngưỡng 500: lỗi 4xx (vd. 404 của một slug) là câu trả lời ĐÚNG, đệm ngắn được.
 */

export const ERROR_NO_STORE_MIN_STATUS = 500
export const ERROR_NO_STORE_VALUE = 'no-store'
const EXEMPT_PREFIXES = ['/_nuxt/', '/_ipx/'] as const

/** Phần đường dẫn (bỏ query/hash) — `event.path` của h3 còn mang query string. */
function pathnameOf(path: string): string {
  const cut = path.search(/[?#]/)
  return cut === -1 ? path : path.slice(0, cut)
}

/**
 * Giá trị `Cache-Control` phải ép cho phản hồi này, hoặc `null` để giữ nguyên.
 * `status` không phải số nguyên hợp lệ → `null` (không đoán).
 */
export function errorResponseCacheControl(status: number, path: string): string | null {
  if (!Number.isInteger(status) || status < ERROR_NO_STORE_MIN_STATUS) return null
  const pathname = pathnameOf(path || '/')
  if (EXEMPT_PREFIXES.some(prefix => pathname.startsWith(prefix))) return null
  return ERROR_NO_STORE_VALUE
}
