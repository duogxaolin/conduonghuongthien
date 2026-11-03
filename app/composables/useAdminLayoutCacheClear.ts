import { ref } from 'vue'

// Relative paths, not `~/`: the layout's mount test (tests/admin-layout.test.ts) loads this
// file as is.
import { adminFetch } from './adminFetch'
import { errorMessage } from '../utils/errorMessage'
import type { Payload } from '../types/handler-payload'
import type { useToast } from './useToast'

type CacheClearHandler = typeof import('~~/server/api/admin/cache-clear.post').default
/** `POST /api/admin/cache-clear` — `{ ok, cleared, message }`. */
export type AdminCacheClearResponse = Payload<CacheClearHandler>

/**
 * Xoá cache SWR của trang công khai. Cán bộ sửa nội dung xong, khách vẫn thấy
 * bản cũ tới 60 giây (routeRules `swr: 60`) — đọc ra là "không update được".
 * Nút này là đường ra tường minh thay vì phải chờ hay tự đoán.
 *
 * Moved from `app/layouts/admin.vue` when it was split (wave3 D-SPLIT); the layout's own
 * `toast` is handed in. The `$fetch` cast it carried became `adminFetch<T>()` (design
 * D-FETCH) — the same request and the same error object, so the same sentences on screen.
 * One purge at a time: the function refuses while one is in flight, not only the buttons.
 */
export function useAdminLayoutCacheClear(toast: Pick<ReturnType<typeof useToast>, 'success' | 'error'>) {
  const isClearingCache = ref(false)

  async function clearPublicCache() {
    if (isClearingCache.value) return
    isClearingCache.value = true
    try {
      const res = await adminFetch<AdminCacheClearResponse>('/api/admin/cache-clear', {
        method: 'POST',
        body: { confirm: true },
      })
      toast.success(res.message || `Đã xoá ${res.cleared} mục cache.`)
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Không thể xoá cache. Thử lại sau ít phút.'))
    } finally {
      isClearingCache.value = false
    }
  }

  return { isClearingCache, clearPublicCache }
}
