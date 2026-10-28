/**
 * Nhịp tim cho luồng SSE của chatbot: một dòng `: ping` sau mỗi khoảng im lặng.
 *
 * Provider AI có thể mất 40–200 giây cho một câu trả lời (suy nghĩ rồi mới có chữ).
 * Suốt thời gian đó không có byte nào trên đường truyền, nên một proxy có
 * `proxy_read_timeout` mặc định 60 giây sẽ cắt kết nối — người đọc mất câu trả lời
 * dù server vẫn đang làm. Một dòng chú thích SSE (`: ping`) mỗi vài giây giữ kết
 * nối sống; client chỉ đọc các dòng `data:` nên bỏ qua nó.
 *
 * Chỉ giữ kết nối, KHÔNG huỷ cuộc gọi AI chậm (quyết định đã chốt: đợi, không bỏ).
 *
 * Endpoint `stop()` trước mỗi lần ghi và `start()` lại sau đó, nên ping chỉ đi khi đã 15 giây không ghi gì:
 * trước chữ đầu tiên, và giữa luồng khi lớp chặn chủ quyền giữ chữ hoặc đã thay câu trả lời mà model vẫn viết.
 */

/** Chú thích SSE: bắt đầu bằng `:`, không phải sự kiện. */
export const SSE_HEARTBEAT_FRAME = ': ping\n\n'

/** Dưới nhiều lần `proxy_read_timeout 60s` của nginx/aaPanel mặc định. */
export const SSE_HEARTBEAT_INTERVAL_MS = 15_000

export function createSseHeartbeat(write: (frame: string) => void) {
  let timer: ReturnType<typeof setInterval> | null = null

  const stop = () => {
    if (timer !== null) clearInterval(timer)
    timer = null
  }

  return {
    start() {
      if (timer !== null) return
      timer = setInterval(() => {
        // Ghi vào kết nối đã đóng thì ném lỗi; một lần là đủ để kết luận người đọc đã
        // đi, dừng luôn thay vì ném mỗi 15 giây.
        try { write(SSE_HEARTBEAT_FRAME) } catch { stop() }
      }, SSE_HEARTBEAT_INTERVAL_MS)
      // Không giữ tiến trình sống chỉ vì nhịp tim.
      ;(timer as { unref?: () => void }).unref?.()
    },
    stop,
  }
}
