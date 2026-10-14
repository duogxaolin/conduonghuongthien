import { onServerPrefetch } from 'vue'
// Đường dẫn tương đối (không `~/`): composable danh sách import tệp này và được
// chạy trong test Node, nơi bộ nạp không biết alias của Nuxt.
import { applySsrFailureResponse, applySsrNotFoundResponse, SSR_FAILURE_HEADERS } from '../utils/ssr-failure-response'

/**
 * Lượt dựng phía máy chủ hỏng → phản hồi 503 + `Cache-Control: no-store` (xem
 * `utils/ssr-failure-response.ts` cho lý do và giới hạn).
 *
 * `settled` là lượt đọc chính của trang (`useAsyncData(...)` — đối tượng trả về
 * `await` được). Trang dùng `lazy: true` nên setup không chờ nó; nhưng phía máy chủ
 * Nuxt vẫn chờ qua `onServerPrefetch` trước khi ghi HTML, nên chờ ở đây cũng không
 * làm trang chậm thêm. `failed` đọc SAU khi lượt đọc xong — đọc trước thì luôn sai.
 *
 * `useRequestEvent()` / `useResponseHeader()` lấy NGAY trong setup: sau một `await`
 * ngữ cảnh Nuxt không còn. Phía trình duyệt không làm gì — thử lại/tải lại do
 * `onMounted` + nút "Thử lại" của trang lo như trước.
 *
 * `options.notFound` (tuỳ chọn): lượt đọc đã khẳng định "không có" → 404 (trang vẫn
 * dựng nhánh "Không tìm thấy" của nó). Chỉ xét khi KHÔNG hỏng — hỏng thì chưa biết.
 */
export function useSsrFailureStatus(
  settled: () => PromiseLike<unknown> | unknown,
  failed: () => boolean,
  options: { notFound?: () => boolean } = {},
) {
  if (!import.meta.server) return
  const event = useRequestEvent()
  const headers = new Map(Object.keys(SSR_FAILURE_HEADERS).map((name) => [name, useResponseHeader(name)]))
  onServerPrefetch(async () => {
    try {
      await settled()
    } catch {
      // Lượt đọc tự ghi lỗi của nó vào `error`; `failed()` bên dưới đọc từ đó.
    }
    const target = event
      ? {
          setStatus: (code: number, text: string) => setResponseStatus(event, code, text),
          setHeader: (name: string, value: string) => {
            const header = headers.get(name)
            if (header) header.value = value
          },
        }
      : null
    const applied = applySsrFailureResponse(target, failed())
    if (!applied && options.notFound) applySsrNotFoundResponse(target, options.notFound())
  })
}
