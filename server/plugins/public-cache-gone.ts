/**
 * Tuyến đệm `swr` dựng ra 404/410 → bỏ bản cũ của tuyến đó (lý do + giới hạn:
 * `server/utils/public-page-cache.ts`).
 *
 * Hai đường một trang báo "không còn":
 *  - `render:response` — trang đặt mã 404 rồi vẫn dựng nhánh "Không tìm thấy" (ArticleDetail
 *    qua `useSsrFailureStatus`). Hook này chạy BÊN TRONG bộ bọc đệm, trên sự kiện proxy của
 *    lượt dựng, nơi Nitro đã gắn `event.context.cache.options` — nên khoá là khoá thật.
 *  - `error` với tag `cache` — trang NÉM `createError(404)` trong một lượt dựng lại nền:
 *    Nitro bắt lỗi đó (cache.mjs, nhánh swr), báo qua `captureError(..., { tags: ['cache'] })`
 *    rồi phát bản cũ. Lượt đầu (chưa có bản đệm) mang tag `request`, không có gì để bỏ.
 *
 * Bỏ ngay trong hook là đủ: bộ bọc không ghi đè vì phản hồi ≥ 400 không qua `validate`.
 */
import { evictGoneCachedRoute, isGoneStatus } from '../utils/public-page-cache'

function errorStatus(error: unknown): unknown {
  if (!error || typeof error !== 'object') return undefined
  const value = error as { statusCode?: unknown, status?: unknown }
  return value.statusCode ?? value.status
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:response', async (response, { event }) => {
    if (!isGoneStatus(response?.statusCode)) return
    await evictGoneCachedRoute(event, 'render')
  })

  nitroApp.hooks.hook('error', async (error, context) => {
    const event = context?.event
    if (!event || !context.tags?.includes('cache')) return
    if (!isGoneStatus(errorStatus(error))) return
    await evictGoneCachedRoute(event, 'error')
  })
})
