/**
 * Lượt dựng phía máy chủ của một trang công khai mà lượt đọc dữ liệu CHÍNH hỏng
 * (CSDL sập, API trả 503) phải trả **503 + `Cache-Control: no-store`**, không phải 200.
 *
 * Lỗi đã gặp (bộ kiểm chứng, bản build chạy với CSDL không với tới): 12 API công khai
 * đã trả 503 + no-store, nhưng TRANG `/`, `/about`, `/contact`, `/<slug>` vẫn trả
 * HTTP 200 kèm `s-maxage=60, stale-while-revalidate` và nhánh lỗi trong HTML — nên
 * chính trang lỗi được bộ đệm SWR (và CDN) phát lại cho mọi người trong cửa sổ đệm.
 *
 * Vì sao 503 là thứ chặn được: bộ đệm route của Nitro chỉ lưu phản hồi có mã < 400
 * (`validate` trong `nitropack/dist/runtime/internal/cache.mjs`). `no-store` chặn
 * CDN/trình duyệt ở các tuyến KHÔNG có `swr` (vd. `/<slug>`).
 * Ở tuyến có `swr` (`/`, `/about`, `/contact`, `/media`, `/news/**`…) Nitro GHI ĐÈ
 * `cache-control` của phản hồi bằng `s-maxage=60, stale-while-revalidate` sau khi
 * trang dựng xong (cùng tệp, dòng gán `headers["cache-control"]`) — từ phía trang
 * không sửa được; phía máy chủ `server/plugins/error-no-store.ts` (hook
 * `beforeResponse`) đặt lại `no-store` cho mọi phản hồi ≥ 500 (`tests/error-no-store.test.ts`;
 * đo trên bản build với CSDL không với tới, 2026-10-14: các tuyến trên trả 503 + `no-store`).
 *
 * Hàm thuần — kiểm không cần Nuxt (`tests/ssr-failure-response.test.ts`).
 */

// Đường dẫn tương đối (không `~/`): tệp này được nạp trong test Node.
import { errorStatus } from './errorMessage'

export const SSR_FAILURE_STATUS = 503
export const SSR_FAILURE_STATUS_TEXT = 'Service Unavailable'
export const SSR_FAILURE_HEADERS: Readonly<Record<string, string>> = Object.freeze({ 'cache-control': 'no-store' })

/** Nơi ghi trạng thái/tiêu đề của phản hồi — `H3Event` thật, hoặc bản giả trong test. */
export interface SsrResponseTarget {
  setStatus: (code: number, text: string) => void
  setHeader: (name: string, value: string) => void
}

/**
 * Ghi 503 + no-store khi `failed`; không làm gì khi lượt đọc thành công. Trả `true`
 * nếu đã ghi. `failed` phải là CHÍNH biểu thức quyết định nhánh lỗi của trang — lệch
 * nhau thì hoặc trang lỗi vẫn 200 (bị đệm), hoặc trang đúng thành 503 (tắt bộ đệm).
 */
export function applySsrFailureResponse(target: SsrResponseTarget | null | undefined, failed: boolean): boolean {
  if (!failed || !target) return false
  target.setStatus(SSR_FAILURE_STATUS, SSR_FAILURE_STATUS_TEXT)
  for (const [name, value] of Object.entries(SSR_FAILURE_HEADERS)) target.setHeader(name, value)
  return true
}

/**
 * Lượt đọc CHÍNH đã khẳng định "không có" (API trả 404) → phản hồi 404, trang vẫn
 * dựng nhánh "Không tìm thấy" của chính nó (không ném sang trang lỗi chung). Không
 * thêm `no-store`: 404 là câu trả lời đúng, không phải sự cố — và bộ đệm route của
 * Nitro vốn không lưu phản hồi ≥ 400. Trả `true` nếu đã ghi.
 */
export function applySsrNotFoundResponse(target: SsrResponseTarget | null | undefined, notFound: boolean): boolean {
  if (!notFound || !target) return false
  target.setStatus(404, 'Not Found')
  return true
}

/**
 * Kết quả lượt đọc chi tiết một bài (`/api/public/articles/<slug>`), dùng CHUNG cho
 * nhánh hiển thị và mã trạng thái SSR của `components/ArticleDetail.vue`.
 *
 * Lỗi đã gặp (bản build trước bản vá): API trả **404** cho bài không có, nhưng trang
 * gộp mọi lỗi vào một `loadError` → bài không tồn tại hiện "Không thể tải nội dung"
 * + "thử lại" với HTTP 200 (được đệm như trang đúng); còn khi CSDL sập trang cũng 200
 * + `s-maxage=60` — trang lỗi được SWR/CDN phát lại.
 *
 *  - `failed`: lỗi không phải 404 (503/500/mạng) → nhánh lỗi + thử lại, SSR 503 + no-store.
 *  - `not-found`: API trả 404, hoặc thành công mà không có bài → "Không tìm thấy", SSR 404.
 *  - `found` / `pending`: không đụng mã trạng thái.
 *
 * Lỗi đứng TRƯỚC dữ liệu (như template cũ): một lượt tải lại hỏng không được hiện
 * như bài cũ còn đó.
 */
export type DetailFetchOutcome = 'pending' | 'found' | 'not-found' | 'failed'

export function resolveDetailFetch({ status, error, hasContent }: {
  /** `status` của `useAsyncData`: 'idle' | 'pending' | 'success' | 'error'. */
  status: string
  error: unknown
  hasContent: boolean
}): DetailFetchOutcome {
  if (status === 'error') return errorStatus(error) === 404 ? 'not-found' : 'failed'
  if (status !== 'success') return 'pending'
  return hasContent ? 'found' : 'not-found'
}
