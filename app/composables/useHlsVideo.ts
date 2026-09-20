/**
 *
 * ## Vì sao có tệp này

 * Hai nơi phát HLS trên cổng: trình phát của một video đã đăng
 * (`MediaPlayer.vue`) và trình phát của một buổi phát trực tiếp (`LiveHero.vue`).
 * Viết `await import('hls.js')` ở cả hai là hai chỗ để lệch nhau về đúng thứ
 * quan trọng nhất — thư viện chỉ được nạp sau khi trang mount. Một bản sao lỡ
 * dùng `import` tĩnh sẽ kéo ~150KB vào gói chính cho **mọi** trang của cổng, và
 * không có gì đỏ ở đâu cả: trang vẫn chạy, chỉ chậm hơn ở mọi nơi.
 *
 * Nên toàn bộ dự án có **đúng một** chuỗi `import('hls.js')`, và nó nằm ở đây.
 *
 * ## `import()` động, không `import` tĩnh

 * `await import('hls.js')` trong một hàm chỉ chạy trong trình duyệt là điều kiện
 * để thư viện không có mặt trong gói chính lẫn trong gói máy chủ. Kiểm chứng
 * bằng cách grep bản **build** (`.output/`), không phải bằng cách đọc tệp này —
 * xem báo cáo của task 14.4.
 *
 * ## Safari/iOS phát HLS gốc

 * `canPlayType('application/vnd.apple.mpegurl')` là phép kiểm **trước** khi tải
 * thư viện. Nạp 150KB rồi mới phát hiện trình duyệt không cần nó là bắt người
 * dùng trả giá cho sự lười.
 */
import type { Ref } from 'vue'

/**
 * Hình dạng tối thiểu của một thực thể `Hls` mà tệp này thật sự dùng.
 *
 * Không `import type Hls from 'hls.js'`: một `import type` là **import tĩnh** ở
 * tầng kiểu, và nó kéo theo một phụ thuộc thời gian biên dịch vào gói mà tệp này
 * cố ý chỉ chạm tới lúc chạy. Cũng không `any` — dự án đã xoá sạch `any`.
 */
type HlsInstance = { destroy: () => void }

export type HlsAttachResult =
  | { ok: true, mode: 'native' | 'library' }
  | { ok: false, reason: 'unsupported' | 'load_failed' }

export type HlsOptions = {
  /**
   * Thực thể đang chạy, để nơi gọi `destroy()` lúc unmount.
   *
   * Truyền vào thay vì trả về vì nơi gọi cần nó **ngay cả khi** hàm này thất bại
   * giữa đường — một lần gán muộn hơn lượt `return` là một thực thể rò rỉ.
   */
  instance: Ref<HlsInstance | null>
  /**
   * Trần bộ đệm, tính bằng giây.
   *
   * Mặc định của hls.js giữ tới 60 giây phía sau. Trên VPS nhỏ với nhiều người
   * xem cùng lúc, đó là RAM của chính máy chủ này.
   */
  bufferSeconds?: number
  /** Gọi khi một lỗi **fatal** xảy ra. Lỗi không fatal là chuyện thường của ABR. */
  onFatalError?: () => void
}

export async function attachHlsStream(
  video: HTMLVideoElement,
  url: string,
  options: HlsOptions,
): Promise<HlsAttachResult> {
  // Safari/iOS: gán thẳng nguồn, không tải thư viện nào.
  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url
    return { ok: true, mode: 'native' }
  }

  try {
    const { default: Hls } = await import('hls.js')

    // `isSupported()` là false trên trình duyệt không có MSE. Nói ra thay vì để
    // một khung đen: người đọc không có cách nào đoán được vì sao không có gì.
    if (!Hls.isSupported()) return { ok: false, reason: 'unsupported' }

    const buffer = options.bufferSeconds ?? 30
    const instance = new Hls({ backBufferLength: buffer, maxBufferLength: buffer })
    options.instance.value = instance

    instance.on(Hls.Events.ERROR, (_event: unknown, data: { fatal?: boolean }) => {
      // Chỉ báo lỗi khi lỗi là `fatal`. Lỗi không fatal là chuyện bình thường của
      // ABR (một phân đoạn chậm, một lần đổi bản) và hls.js tự phục hồi — hiện
      // chúng lên là dạy người đọc bỏ qua cảnh báo.
      if (data?.fatal) options.onFatalError?.()
    })

    instance.loadSource(url)
    instance.attachMedia(video)
    return { ok: true, mode: 'library' }
  } catch {
    // Gói không tải được: mạng chập chờn, hoặc một proxy chặn chunk. Nơi gọi
    // phải nói ra thành một câu giải thích, không để lại một khung đen im lặng.
    return { ok: false, reason: 'load_failed' }
  }
}

/** Dọn thực thể đang chạy. Không dọn thì nó giữ timer và kết nối phân đoạn sống
 *  lâu hơn trang đã rời đi. */
export function detachHlsStream(instance: Ref<HlsInstance | null>): void {
  instance.value?.destroy()
  instance.value = null
}
