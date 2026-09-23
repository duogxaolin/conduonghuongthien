/**
 * Composable khởi tạo Plyr — trình phát video wrap `<video>` element với UI sạch
 * hơn native controls (thanh tua tùy biến, tốc độ phát, phím tắt, toàn màn hình).
 *
 * ## Vì sao tách ra (cùng lối `useHlsVideo.ts`)
 *
 * Plyr (~50KB gzip) chỉ dùng ở trang `/media` chi tiết video. Nhúng tĩnh sẽ kéo
 * gói này vào **mọi** trang của cổng — một công dân đọc bài tấm gương trên 3G
 * không nên trả giá cho một thư viện video. Nên toàn bộ dự án có **đúng một**
 * chuỗi `import('plyr')`, nằm ở đây, gọi từ `MediaPlayer.vue` sau khi trang
 * đã mount.
 *
 * ## Chỉ nhánh upload, KHÔNG nhánh youtube
 *
 * CLAUDE.md (MediaPlayer.vue dòng 27-39) cảnh báo: Plyr nạp `youtube.com/
 * iframe_api` khi cấu hình provider YouTube — vi phạm "Third-party asset
 * isolation". Nhưng khởi tạo Plyr trên `<video>` element **thuần** (không
 * provider youtube, không nguồn youtube URL) không trigger nhánh nạp đó —
 * nó chỉ wrap element và dùng native/HLS source đã gán. Vậy nhánh youtube của
 * `MediaPlayer.vue` giữ iframe `youtube-nocookie` thẳng, không qua Plyr.
 *
 * ## Thứ tự với hls.js
 *
 * Trường hợp HLS (`streamKind='hls'`, đã transcode): hls.js attach source vào
 * `<video>` element **trước** (qua `useHlsVideo`), rồi Plyr wrap chính element
 * đó sau. Plyr đọc media qua element, không cần instance Hls trực tiếp. Trường
 * hợp passthrough mp4 (`streamKind='file'`): gán `video.src` rồi Plyr wrap.
 */
import type { Ref } from 'vue'

/**
 * Hình dạng tối thiểu của một thực thể Plyr mà tệp này thật sự dùng.
 *
 * Không `import type Plyr from 'plyr'`: một `import type` là import tĩnh ở tầng
 * kiểu, kéo phụ thuộc biên dịch vào gói cố ý chỉ chạm lúc chạy. Cũng không
 * `any` — dự án đã xoá sạch `any`.
 */
export type PlyrInstance = { destroy: () => void }

export type PlyrOptions = {
  /** Thực thể đang chạy, để nơi gọi `destroy()` lúc unmount. */
  instance: Ref<PlyrInstance | null>
  /**
   * Cầu chất lượng cho HLS. Khi hls.js attach xong và manifest đã parse, tệp này
   * cần biết các bản có sẵn (`levels`) và cách đổi bản (`setLevel`) để populate
   * menu "Chất lượng" của Plyr. Passthrough mp4 (chỉ một bản) không truyền cầu
   * này — Plyr sẽ ẩn menu chất lượng vì `quality.options` rỗng, đúng hành vi.
   *
   * Truyền qua option thay vì đọc thẳng instance Hls: `useHlsVideo.ts` cố ý chỉ
   * expose `{ destroy }`, và bóc thêm `levels`/`currentLevel` ra đó chỉ để phục
   * vụ Plyr là một phụ thuộc chéo mà bên kia không có lý do gì để biết tới.
   */
  hlsQuality?: HlsQualityBridge
}

/**
 * Cầu giữa hls.js (nguồn levels thực) và Plyr (menu chất lượng). Plyr không tự
 * đọc `Hls.levels` — phải báo cho nó biết các bản có sẵn và cách đổi bản.
 */
export type HlsQualityBridge = {
  /**
   * Trả các chiều cao bản có sẵn (vd `[360, 720, 1080]`), hoặc `null` khi chưa
   * parse xong / chỉ có một bản / không phải HLS. Plyr ẩn menu khi `null`.
   */
  getLevels: () => number[] | null
  /**
   * Đổi bản theo chiều cao. `-1` = tự động (ABR theo băng thông, `hls.currentLevel
   * = -1`); `n` (vd 720) = cố định bản cao `n`. Bridge tự tìm level index trong
   * `hls.levels` khớp chiều cao `n` rồi gán `hls.currentLevel`.
   */
  setLevel: (height: number) => void
}

/**
 * Khởi tạo Plyr trên một `<video>` element đã có source (gán `src` hoặc hls.js
 * đã attach). Trả `ok` hoặc lý do thất bại để nơi gọi nói ra thành câu giải thích.
 *
 * Plyr CSS cũng nạp động (`import('plyr/dist/plyr.css')`) — không `@import` tĩnh
 * để giữ gói chính sạch.
 */
export async function attachPlyrPlayer(
  video: HTMLVideoElement,
  options: PlyrOptions,
): Promise<{ ok: true } | { ok: false, reason: 'load_failed' }> {
  try {
    // CSS đồng thời với JS — hai import động độc lập, parallel.
    const [{ default: Plyr }] = await Promise.all([
      import('plyr'),
      // CSS side-effect import: Vite/Nuxt bơm `<style>` khi chunk này tải.
      // Không có await ở đây vì CSS không block khởi tạo player, và một CSS
      // chậm không nên giữ UI player đứng chờ.
      import('plyr/dist/plyr.css').catch(() => {}),
    ])

    // Nút tua ±10s: plyr có sẵn `rewind` + `fast-forward` nhưng mặc định tắt
    // (comment trong `plyr.mjs`). `seekTime: 10` (bên dưới) quyết định số giây —
    // cùng giá trị cho cả hai nút và phím tắt mũi tên trái/phải. Tooltip tự hiện
    // "Lui {seektime}s" / "Tới {seektime}s" nên công dân không phải đoán.
    //
    // Quality: khi `hlsQuality` vắng (passthrough mp4, chỉ một bản), `options`
    // rỗng → Plyr tự ẩn menu "Chất lượng" (không hiển thị một menu một mục).
    // Khi có bridge HLS, `options` là các chiều cao bản + "Tự động" (giá trị 0)
    // và `forced: true` để Plyr dùng menu này thay vì thử đọc `video.qualityLevels`
    // (API không có ở hls.js).
    const levels = options.hlsQuality?.getLevels() ?? null
    const qualityOptions = levels && levels.length > 1
      ? [0, ...levels.slice().sort((a, b) => a - b)] // 0 = Tự động, rồi từ thấp đến cao
      : []
    const instance = new Plyr(video, {
      controls: [
        'play-large', 'rewind', 'play', 'fast-forward', 'progress', 'current-time',
        'duration', 'mute', 'volume', 'settings', 'pip', 'airplay', 'fullscreen',
      ],
      settings: ['speed', 'quality'],
      speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] },
      // `forced: true` + `onChange` là cách plyr khuyên bridge với hls.js: menu
      // do ta cung cấp, đổi bản do ta quyết định. Không `forced` → plyr cố đọc
      // `video.qualityLevels` (HLS native) hoặc `hls.levels` (không expose) →
      // menu trống hoặc không đổi bản thực.
      quality: {
        default: 0,
        options: qualityOptions,
        forced: true,
        onChange: (selected: number) => {
          // `selected` là giá trị trong `options` — 0 = "Tự động", >0 = chiều cao
          // bản (vd 720). Bridge tự map chiều cao → level index trong `hls.levels`
          // (một nguồn chân lý duy nhất). 0 → -1 (ABR theo băng thông).
          options.hlsQuality?.setLevel(selected === 0 ? -1 : selected)
        },
      },
      ratio: '16:9',
      keyboard: { focused: true, global: false },
      i18n: {
        rewind: 'Lui {seektime}s',
        fastForward: 'Tới {seektime}s',
        speed: 'Tốc độ phát',
        quality: 'Chất lượng',
        // Nhãn "Tự động" cho giá trị 0 trong menu chất lượng (ABR theo băng thông).
        // Plyr tra `qualityLabel.<value>` — 0 là "Tự động" thay vì "0p" vô nghĩa.
        qualityLabel: {
          0: 'Tự động',
        },
      },
      tooltips: { seek: true },
      seekTime: 10,
    })
    options.instance.value = instance as unknown as PlyrInstance
    return { ok: true }
  } catch {
    // Gói không tải được: mạng chập chờn, proxy chặn chunk, hoặc server ffmpeg
    // transcode chưa xong. Nơi gọi phải nói ra thành câu giải thích, không để
    // khung đen im lặng.
    return { ok: false, reason: 'load_failed' }
  }
}

/** Dọn thực thể Plyr. Không dọn thì nó giữ listener và timer sống lâu hơn trang. */
export function detachPlyrPlayer(instance: Ref<PlyrInstance | null>): void {
  instance.value?.destroy()
  instance.value = null
}
