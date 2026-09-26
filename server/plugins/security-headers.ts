/**
 * Xoá header `x-powered-by: Nuxt` khỏi mọi HTML response.
 *
 * Nuxt renderer đặt header này hardcoded ở hai đường:
 *  - non-streamed: trả về `response.headers["x-powered-by"]` rồi Nitro áp lên event
 *    SAU khi hook `render:response` chạy (nitropack/.../renderer.mjs:35-37).
 *  - streamed: `setResponseHeader(event, "x-powered-by", "Nuxt")` trực tiếp lên event
 *    (nuxt/nitro-server/.../renderer.mjs:508) — không đi qua `response.headers`.
 *
 * `nitro: { hidePoweredBy: true }` chỉ xoá phần Nitro tự thêm, không đụng phần Nuxt
 * thêm. lộ framework trên response là tín hiệu miễn phí cho người quét chọn exploit
 * phù hợp. Đây là cách duy nhất tắt nó mà không patch node_modules.
 *
 * Phải dùng Nitro plugin + hook `render:response` (chạy sau renderer, trước khi
 * `setResponseHeaders` áp `ctx.response.headers` lên event). Middleware H3 chạy
 * TRƯỚC renderer nên không thể xoá header renderer chưa đặt. Cùng pattern với
 * `server/plugins/favicon.ts`.
 *
 * Hai việc cùng lúc: xoá khỏi `ctx.response.headers` (cho non-streamed, vì Nitro
 * áp `ctx.response.headers` lên event sau hook) và `removeResponseHeader(event)`
 * (cho streamed, vì header đã đặt trực tiếp lên event và `ctx.response` không có
 * headers để sửa). API routes không đi qua Nuxt renderer nên header này vốn không
 * có — không ảnh hưởng.
 */
import { removeResponseHeader } from 'h3'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:response', (response, { event }) => {
    if (response?.headers) {
      delete response.headers['x-powered-by']
      delete response.headers['X-Powered-By']
    }
    if (event) {
      removeResponseHeader(event, 'x-powered-by')
    }
  })
})
