/**
 * Gộp các lời gọi ĐỒNG THỜI cùng một khoá thành MỘT lượt chạy đang bay.
 *
 * Vì sao có: `useI18n()` được gọi trong setup của MỌI component dùng `t()` (~28 cái trên trang chủ).
 * Mỗi lời gọi kiểm "kho bản dịch còn rỗng?" và tự tải — mà kho chỉ đầy SAU khi phản hồi đầu về, nên cả 28 lời
 * gọi đều thấy "còn rỗng" và cùng bắn một yêu cầu: mỗi lượt mở trang = 28 × `/api/public/translations/vi`
 * (~35 KB, không cache) + 28 × `/api/public/languages`. Đo thật trên cdht.delify.vn: 56 yêu cầu / lượt tải.
 *
 * Chỉ gộp lúc đang bay: xong (thành công hay lỗi) thì khoá được giải phóng, lời gọi sau đó chạy lại bình thường
 * (đổi ngôn ngữ, thử lại sau lỗi). Lỗi của tác vụ được chuyển cho MỌI bên đang chờ.
 */
export function createSingleFlight() {
  const inflight = new Map<string, Promise<unknown>>()
  return function singleFlight<T>(key: string, task: () => Promise<T>): Promise<T> {
    const existing = inflight.get(key)
    if (existing) return existing as Promise<T>
    const promise = Promise.resolve().then(task).finally(() => {
      if (inflight.get(key) === promise) inflight.delete(key)
    })
    inflight.set(key, promise)
    return promise
  }
}
