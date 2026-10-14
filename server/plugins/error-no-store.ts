/**
 * `Cache-Control: no-store` cho mọi phản hồi lỗi máy chủ (≥ 500) — kể cả ở tuyến
 * có `swr` (`/`, `/about`, `/contact`, `/media`, `/news/**`…), nơi bộ bọc đệm của
 * Nitro ghi đè `cache-control` bằng `s-maxage=60, stale-while-revalidate` bất kể mã
 * trạng thái. Lý do + quyết định thuần: `server/utils/error-cache-control.ts`.
 *
 * Vì sao `beforeResponse` (không phải `render:response` hay middleware):
 *  - middleware chạy TRƯỚC handler — tiêu đề chưa bị ghi đè;
 *  - `render:response` chạy BÊN TRONG handler đã bọc swr — bộ bọc ghi đè sau nó;
 *  - `beforeResponse` (h3 `onBeforeResponse`) chạy sau khi handler (gồm bộ bọc swr)
 *    trả về và trước khi thân phản hồi được ghi; `afterResponse` thì đã quá muộn.
 * Lỗi NÉM ra (createError) không đi qua hook này — trình xử lý lỗi của Nitro tự đặt
 * tiêu đề, bộ bọc swr không chạm tới chúng.
 */
import { setResponseHeader } from 'h3'
import { errorResponseCacheControl } from '../utils/error-cache-control'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('beforeResponse', (event) => {
    const res = event.node.res
    if (res.headersSent) return
    const value = errorResponseCacheControl(res.statusCode, event.path)
    if (value) setResponseHeader(event, 'cache-control', value)
  })
})
