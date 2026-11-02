/**
 * Bộ đệm `swr` của trang công khai — xoá ở MỘT chỗ, và không bao giờ phát lại một
 * trang đã không còn.
 *
 * ## Vì sao cần
 *
 * Mọi tuyến công khai chạy `swr: 60` (nuxt.config.ts routeRules). Bộ bọc đệm của Nitro
 * (`nitropack/runtime/internal/cache.mjs`) **chỉ lưu phản hồi < 400**: lượt dựng lại nền
 * cho ra 404 thì bị bỏ, và bản 200 cũ ở lại — rồi được phát tiếp cho mọi khách, **mãi
 * mãi**, vì mỗi lượt sau lại dựng lại, lại ra 404, lại bị bỏ. Đo trên bản build
 * 1009c36c: bài đã xoá / đã lưu trữ vẫn 200 đủ nội dung sau 65, 68, 71 giây; chỉ nút
 * "Xoá cache" mới làm nó thành 404. Từ 2026-10-14 (68967451) bài không có mới trả 404
 * thật — trước đó trang "không tìm thấy" là 200, được lưu đè, nên lỗi không lộ.
 *
 * Hai lớp, mỗi lớp đóng một nửa:
 *  1. `purgePublicPageCacheAfterWrite` — gọi SAU khi một lượt ghi nội dung công khai đã
 *     commit (bài, menu, cài đặt giao diện): khách thấy ngay, không đợi 60 giây.
 *  2. `evictGoneCachedRoute` (plugin `public-cache-gone.ts`) — khi lượt dựng của một tuyến
 *     đệm ra 404/410 thì bỏ bản cũ của chính tuyến đó. Lớp 1 một mình còn hở: một lượt
 *     dựng lại bắt đầu TRƯỚC commit, xong SAU lượt xoá, ghi lại bản 200 cũ — và 404 sau đó
 *     lại bị Nitro bỏ. Lớp 2 cũng phủ mọi đường làm trang biến mất mà không qua lớp 1
 *     (sửa thẳng CSDL, endpoint mới quên gọi). 5xx thì KHÔNG bỏ: phát bản cũ trong lúc
 *     CSDL chập chờn chính là việc của swr.
 *
 * ## Hình dạng khoá (đừng lọc theo đường dẫn)
 *
 * Nitro đặt mỗi mục dưới `cache:nitro:routes:_:<đường dẫn bỏ ký tự không phải chữ, cắt 16
 * ký tự>.<băm cả URL>.json` — `/news/bai-xoa` thành `nitro:routes:_:newsbaixoa.<hash>.json`,
 * mỗi biến thể `?query` và mỗi `_payload.json` một mục riêng. Không suy ngược được ra đường
 * dẫn, nên "chỉ xoá trang của bài này" không làm được đáng tin cậy — và một bài hiện ở cả
 * `/news/x`, `/news/<chuyên mục>/x`, trang chủ, các danh sách, khối liên quan của bài khác.
 * Lớp 1 xoá cả nhóm (đúng việc nút "Xoá cache" làm); lớp 2 không đoán khoá mà hỏi chính
 * Nitro (`event.context.cache.options.getKey`).
 *
 * `useStorage` là auto-import của Nitro: chỉ gọi được trong tiến trình máy chủ.
 */
import type { H3Event } from 'h3'
import { logWarn } from './logger'

/** Nhóm Nitro dùng cho bộ đệm theo tuyến (`app.mjs`: `group: "nitro/routes"`). */
export const ROUTE_CACHE_GROUP = 'nitro/routes'

/**
 * Xoá mọi bản đệm trang công khai (HTML và `_payload.json`). Trả số mục đã xoá.
 * Ném lỗi của storage ra ngoài — nút "Xoá cache" cần biết là hỏng.
 */
export async function purgePublicPageCache(): Promise<number> {
  const storage = useStorage('cache')
  const keys = await storage.getKeys(ROUTE_CACHE_GROUP)
  await Promise.all(keys.map(key => storage.removeItem(key)))
  return keys.length
}

/**
 * Sau một lượt ghi ĐÃ commit: xoá bộ đệm trang công khai, không bao giờ ném.
 *
 * Gọi sau `await db.transaction(...)` (hay sau lời gọi dịch vụ đã ghi xong), không bao giờ
 * bên trong: xoá trước commit thì một lượt dựng chen vào giữa đọc lại dữ liệu cũ và đệm
 * lại nó; rollback thì đã xoá cho một thay đổi không xảy ra. Lỗi chỉ được ghi log — lượt
 * ghi đã thành công không được trả 500 vì bộ đệm, và lớp 2 + hạn 60 giây vẫn còn đó.
 */
export async function purgePublicPageCacheAfterWrite(reason: string): Promise<void> {
  try {
    await purgePublicPageCache()
  } catch (error) {
    logWarn({ event: 'public_cache.purge_failed', reason, error: error instanceof Error ? error.message : String(error) })
  }
}

/** 404/410 = trang không còn. Chỉ hai mã này: 5xx là "tạm hỏng", bản cũ vẫn đáng phát. */
export function isGoneStatus(status: unknown): boolean {
  return status === 404 || status === 410
}

/** Phần tuỳ chọn đệm mà Nitro gắn vào `event.context.cache.options` khi đang dựng một tuyến đệm. */
type RouteCacheOptions = {
  getKey: (event: H3Event) => unknown
  base?: unknown
  group?: unknown
  name?: unknown
}

function routeCacheOptions(event: H3Event): RouteCacheOptions | null {
  const options = (event.context as { cache?: { options?: Partial<RouteCacheOptions> } } | undefined)?.cache?.options
  if (!options || typeof options.getKey !== 'function') return null
  // Chỉ bộ đệm theo tuyến; `defineCachedEventHandler` tự viết (nhóm `nitro/handlers`) không phải việc ở đây.
  if (options.group !== ROUTE_CACHE_GROUP) return null
  return options as RouteCacheOptions
}

/**
 * Khoá gốc của một mục, đúng công thức `defineCachedFunction` (cache.mjs):
 * `[base, group, name, key + ".json"].filter(Boolean).join(":").replace(/:\/$/, ":index")`,
 * với mặc định `base: "/cache"`, `name: "_"` (`defaultCacheOptions`). Test chạy bộ đệm
 * THẬT của Nitro canh công thức này — Nitro đổi hình dạng khoá thì test đỏ.
 */
export function routeCacheStorageKey(options: Pick<RouteCacheOptions, 'base' | 'group' | 'name'>, key: string): string {
  const base = typeof options.base === 'string' ? options.base : '/cache'
  const name = typeof options.name === 'string' && options.name ? options.name : '_'
  return [base, options.group, name, `${key}.json`].filter(Boolean).join(':').replace(/:\/$/, ':index')
}

/**
 * Lượt dựng của một tuyến đệm vừa ra 404/410: bỏ bản cũ của CHÍNH tuyến đó, để lượt kế
 * tiếp dựng lại và trả 404 thay vì phát bản 200 cũ mãi mãi. Không phải tuyến đệm → không
 * làm gì. Không bao giờ ném (một lượt dọn hỏng không được làm hỏng phản hồi đang dựng).
 */
export async function evictGoneCachedRoute(event: H3Event, source: 'render' | 'error'): Promise<boolean> {
  try {
    const options = routeCacheOptions(event)
    if (!options) return false
    const key = await options.getKey(event)
    if (typeof key !== 'string' || !key) return false
    await useStorage().removeItem(routeCacheStorageKey(options, key))
    return true
  } catch (error) {
    logWarn({ event: 'public_cache.evict_failed', source, error: error instanceof Error ? error.message : String(error) })
    return false
  }
}
