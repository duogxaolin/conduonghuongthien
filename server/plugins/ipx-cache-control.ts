/**
 * IPX (NuxtImg) trả 5xx khi R2 fetch tạm lỗi lúc deploy/cold-start. routeRules
 * `/_ipx/**` set `cache-control: immutable 1 năm` TRƯỚC handler chạy
 * (nitropack `route-rules.mjs:21` gọi `setHeaders` không kiểm status), nên
 * response 500 inherits `immutable` → Cloudflare cache 500 đúng 1 năm → ảnh
 * vỡ vĩnh viễn trên prod (đã trả giá 2026-10-07: cdht.delify.vn ảnh vỡ hàng
 * loạt, `cf-cache-status: HIT` trên response 500).
 *
 * Hook `beforeResponse` (`nitropack/.../app.mjs:81-84`) chạy SAU IPX handler,
 * TRƯỚC khi gửi response — đọc status từ `event.node.res.statusCode` (hook
 * arg chỉ có `{ body }`, không có status). Nếu path `/_ipx/` và status >= 400,
 * override `cache-control` → `no-store` để CF/Nginx không cache error. Request
 * lại IPX sẽ thử fetch R2 — R2 đã sẵn sàng thì trả 200, CF cache 200 (immutable)
 * như planned. Hook chạy cho cả error path (h3 `index.mjs:2332` — `event.handled`
 * vẫn `false` sau `send()` nên hook KHÔNG bị skip).
 *
 * Cùng pattern với `server/plugins/security-headers.ts` (dùng Nitro hook để
 * sửa header sau renderer). Không dùng H3 middleware vì middleware chạy
 * trước handler → không biết status.
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('beforeResponse', (event, response) => {
    const path = event.path?.split('?')[0] ?? ''
    if (!path.startsWith('/_ipx/')) return
    // `beforeResponse` hook chỉ nhận `{ body }` (không có status) — đọc
    // status từ `event.node.res.statusCode` (handler đã set lúc này).
    const status = event.node.res.statusCode || 200
    if (status >= 400) {
      setResponseHeader(event, 'cache-control', 'no-store, max-age=0')
    }
  })
})
