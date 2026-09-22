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
  /**
   * Gọi khi manifest đã parse xong — hls.js đã biết danh sách bản (levels). Nhận
   * callback expose các chiều cao bản + cách đổi bản, để nơi gọi (MediaPlayer)
   * dựng cầu chất lượng cho Plyr.
   *
   * Chỉ gọi ở mode `library` (hls.js), không ở `native` (Safari/iOS phát HLS gốc
   * — không expose levels qua API chung, và trình duyệt tự quản lý ABR).
   */
  onManifestParsed?: (bridge: HlsManifestParsed) => void
}

/**
 * Ảnh chụp manifest khi parse xong, expose đúng phần Plyr cần: các chiều cao
 * bản có sẵn và cách đổi bản. Giấu index của `hls.levels` — Plyr chỉ biết height.
 */
export type HlsManifestParsed = {
  /** Chiều cao các bản có sẵn, vd `[360, 720, 1080]`. */
  levels: number[]
  /**
   * Đổi bản: `-1` = tự động (ABR), `n` = cố định bản cao `n` (tìm trong levels
   * khớp chiều cao). Âm thanh / video index nội bộ của hls.js không lộ ra đây.
   */
  setLevel: (height: number) => void
}

export async function attachHlsStream(
  video: HTMLVideoElement,
  url: string,
  options: HlsOptions,
): Promise<HlsAttachResult> {
  // **Ưu tiên hls.js (library mode) khi có MSE**, kể cả khi trình duyệt khai hỗ
  // trợ HLS gốc. Chrome/Edge/Firefox báo `canPlayType('...mpegurl')` trả
  // `'maybe'` (truthy) nhưng **không** phát HLS thật — không có native demuxer.
  // Tin `canPlayType` trên Chromium là gán `.m3u8` thẳng vào `<video src>`, và
  // Chrome ngồi đó với native controls trống không phát được gì: không có lỗi,
  // không có manifest parse, không có menu chất lượng. Mãi trên Safari/iOS mới
  // `canPlayType` thực sự phát được, và ở đó `Hls.isSupported()` là `false`
  // (Safari cũ) hoặc ta **chọn** không dùng thư viện vì native đã đủ.
  //
  // Thứ tự:
  //   1. `canPlayType('application/vnd.apple.mpegurl')` === 'probably' (Safari/iOS)
  //      → native. **Phải kiểm TRƯỚC khi tải thư viện**: Safari/iOS không có MSE
  //      nên `Hls.isSupported()` là false, nhưng nếu tải hls.js trước rồi mới phát
  //      hiện điều đó thì khách đã trả 150KB vô dụng — đúng cái test này tồn tại để bắt.
  //      Chỉ chấp nhận `'probably'`: Chromium báo `'maybe'` (truthy) nhưng **không**
  //      phát HLS thật — tin `'maybe'` là gán `.m3u8` vào `<video src>` rồi ngồi với
  //      native controls trống. Safari/iOS trả `'probably'` và ở đó native đủ tốt.
  //   2. `Hls.isSupported()` (MSE) → library mode (Chrome/FF/Edge), có levels.
  //   3. Còn lại → không hỗ trợ.
  if (video.canPlayType('application/vnd.apple.mpegurl') === 'probably') {
    video.src = url
    return { ok: true, mode: 'native' }
  }

  try {
    const { default: Hls } = await import('hls.js')

    if (Hls.isSupported()) {
      const buffer = options.bufferSeconds ?? 30
      const instance = new Hls({ backBufferLength: buffer, maxBufferLength: buffer })
      options.instance.value = instance

      instance.on(Hls.Events.ERROR, (_event: unknown, data: { fatal?: boolean }) => {
        // Chỉ báo lỗi khi lỗi là `fatal`. Lỗi không fatal là chuyện bình thường của
        // ABR (một phân đoạn chậm, một lần đổi bản) và hls.js tự phục hồi — hiện
        // chúng lên là dạy người đọc bỏ qua cảnh báo.
        if (data?.fatal) options.onFatalError?.()
      })

      // `MANIFEST_PARSED` là lúc hls.js đã biết danh sách bản (levels). Plyr không
      // tự đọc `hls.levels`, nên ở đây expose các chiều cao + cách đổi bản qua
      // callback để MediaPlayer dựng cầu chất lượng cho Plyr. Chỉ một bản → menu
      // rỗng → Plyr ẩn (không hiển thị menu một mục).
      if (options.onManifestParsed) {
        const hls = instance as unknown as {
          levels?: Array<{ height?: number }>
          currentLevel: number
        }
        instance.on(Hls.Events.MANIFEST_PARSED, () => {
          const heights = (hls.levels ?? [])
            .map(l => l.height)
            .filter((h): h is number => typeof h === 'number' && h > 0)
          options.onManifestParsed?.({
            levels: heights,
            setLevel: (height: number) => {
              // -1 = ABR tự động; >0 = tìm level index khớp chiều cao, trễ thì giữ ABR
              // (tránh `currentLevel = undefined` khiến hls.js ném).
              if (height === -1) {
                hls.currentLevel = -1
                return
              }
              const idx = (hls.levels ?? []).findIndex(l => l?.height === height)
              if (idx >= 0) hls.currentLevel = idx
            },
          })
        })
      }

      instance.loadSource(url)
      instance.attachMedia(video)
      return { ok: true, mode: 'library' }
    }
  } catch {
    // Gói không tải được: mạng chập chờn, hoặc một proxy chặn chunk. Nơi gọi
    // phải nói ra thành một câu giải thích, không để lại một khung đen im lặng.
    return { ok: false, reason: 'load_failed' }
  }

  // Không MSE, không native HLS → trình duyệt không phát được video này.
  // `canPlayType` đã kiểm ở đầu hàm; đến đây là trình duyệt không hỗ trợ cả hai.
  return { ok: false, reason: 'unsupported' }
}

/** Dọn thực thể đang chạy. Không dọn thì nó giữ timer và kết nối phân đoạn sống
 *  lâu hơn trang đã rời đi. */
export function detachHlsStream(instance: Ref<HlsInstance | null>): void {
  instance.value?.destroy()
  instance.value = null
}
