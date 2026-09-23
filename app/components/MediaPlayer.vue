<!--
  Trình phát của một mục media, chọn cơ chế theo `source` của chính mục đó.

  ## Hai cơ chế, và lý do chúng khác nhau

  • **`source: 'upload'`** — video nằm trên chính cổng này, phát qua HLS
    (`/api/public/media/<slug>/stream` trả `master.m3u8`). Cần `hls.js` trên
    Chrome/Firefox/Edge vì chúng không có bộ giải mã HLS gốc; Safari và iOS thì
    có, nên nhánh đó gán thẳng `src` và **không nạp thư viện nào cả**.

  • **`source: 'youtube'`** — nhúng trình phát của chính nền tảng qua `embedUrl`,
    do máy chủ dựng từ định danh đã lưu. Không nạp thư viện nào.

  ## Thư viện chỉ được nạp SAU khi trang media mount

  Đây là yêu cầu của đặc tả ("Playback library is not in the global bundle"),
  không phải một tinh chỉnh hiệu năng: `hls.js` là ~150KB mà phần lớn số trang
  của cổng không bao giờ dùng tới, và một công dân đọc một bài tấm gương trên 3G
  không nên trả giá cho một thư viện video.

  Nên tệp này **không có `import` tĩnh nào** tới thư viện. Việc nạp nằm trong
  `attachHlsStream()` (`app/composables/useHlsVideo.ts`), gọi từ `onMounted`, và
  đó là **chuỗi `import('hls.js')` duy nhất trong toàn dự án** — hai bản sao là
  hai chỗ để một bản lỡ dùng `import` tĩnh mà không có gì đỏ ở đâu cả. Kiểm chứng
  bằng cách grep bản **build** (`.output/`), không phải bằng cách đọc tệp này.

  ## Vì sao KHÔNG dùng `plyr` cho nhánh YouTube

  Đã đo trong `node_modules/plyr/dist/plyr.mjs`: trình phát này nạp
  `https://www.youtube.com/iframe_api` (khai ở dòng 3548, dùng ở dòng 5891). Đặc
  tả "Third-party asset isolation" nói trang media **không được** để trình duyệt
  người đọc chạm tới máy chủ của bên thứ ba, *trừ miền nhúng không cookie của
  chính nền tảng đó* — `www.youtube.com` không phải miền đó, và `noCookie: true`
  chỉ đổi `host` của iframe chứ không đổi tên miền nạp SDK.

  Nên nhánh YouTube dùng thẳng iframe `youtube-nocookie` do máy chủ dựng sẵn:
  đúng miền không cookie, không thêm một script bên thứ ba nào, và vẫn có đủ điều
  khiển (play, tua, chất lượng, phụ đề, toàn màn hình) vì đó là trình phát của
  chính YouTube.

  ## Không bao giờ `v-html`

  Tiêu đề và mô tả là chữ do cán bộ gõ. Chúng đi qua `{{ }}` hoặc qua thuộc tính,
  không bao giờ qua `v-html` — cùng quy tắc `/qa-documents` và luồng bình luận.
-->
<template>
  <div class="w-full">
    <!-- ── Nguồn ngoài: trình phát của chính nền tảng, miền không cookie ── -->
    <template v-if="item.source === 'youtube'">
      <div v-if="item.embedUrl" class="relative w-full aspect-video bg-black rounded-xl overflow-hidden shadow-sm">
        <iframe
          :src="item.embedUrl"
          :title="item.title"
          class="absolute inset-0 w-full h-full border-0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerpolicy="strict-origin-when-cross-origin"
          allowfullscreen
        ></iframe>
      </div>
      <!--
        `embedUrl` là `null` khi định danh đã lưu không qua được phép kiểm ở máy
        chủ. Một khung iframe trắng không nói lên điều gì với người đọc, nên chỗ
        này nói ra.
      -->
      <div v-else role="alert" class="bg-white border border-dashed border-[#E2A0A0] rounded-xl px-6 py-10 text-center">
        <i class="fa-solid fa-triangle-exclamation text-[#B04A4A] text-2xl mb-3" aria-hidden="true"></i>
        <p class="m-0 text-[0.95rem] text-[#B04A4A] font-semibold">Video này chưa phát được.</p>
        <p class="m-0 mt-1 text-sm text-[#667768]">Đường dẫn video nguồn không hợp lệ. Vui lòng báo cho ban quản trị cổng.</p>
      </div>
    </template>

    <!-- ── Video tự lưu trữ, đã có ít nhất một bản sẵn sàng ── -->
    <template v-else-if="item.playable && item.streamUrl">
      <div class="relative w-full aspect-video bg-black rounded-xl overflow-hidden shadow-sm">
        <video
          ref="videoEl"
          class="absolute inset-0 w-full h-full"
          controls
          playsinline
          preload="metadata"
          :poster="item.thumbnailUrl || undefined"
        ></video>

        <!--
          Trạng thái chờ thư viện. `hls.js` là một gói riêng được tải sau khi
          component dựng, nên trên đường truyền chậm có một khoảng thật giữa lúc
          khung hình hiện ra và lúc bấm play được. Không có nhánh này thì khoảng
          đó đọc ra là "trình phát hỏng".
        -->
        <div
          v-if="playerPending"
          role="status"
          aria-busy="true"
          class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 text-white"
        >
          <span class="sr-only">Đang chuẩn bị trình phát</span>
          <i class="fa-solid fa-circle-notch fa-spin text-2xl" aria-hidden="true"></i>
          <span class="text-sm font-semibold">Đang chuẩn bị trình phát…</span>
        </div>
      </div>

      <!--
        Lỗi thư viện. Tách khỏi nhánh "chưa có bản nào sẵn sàng" vì đây là hai
        chuyện khác nhau và cách xử lý cũng khác: một bên là chờ xử lý xong, một
        bên là thử lại.
      -->
      <div
        v-if="playerError"
        role="alert"
        class="mt-3 bg-white border border-dashed border-[#E2A0A0] rounded-xl px-5 py-4 text-[#B04A4A] text-sm flex items-start gap-3"
      >
        <i class="fa-solid fa-triangle-exclamation mt-0.5" aria-hidden="true"></i>
        <span>{{ playerError }}</span>
      </div>
    </template>

    <!-- ── Chưa có bản nào sẵn sàng: nói ra, không dựng một trình phát sẽ hỏng ── -->
    <div v-else class="bg-white border border-dashed border-[#D5E1D3] rounded-xl px-6 py-12 text-center">
      <div class="w-14 h-14 rounded-full bg-[#EEF4EC] text-[#4A6741] flex items-center justify-center mx-auto mb-4 text-xl">
        <i class="fa-solid fa-film" aria-hidden="true"></i>
      </div>
      <p class="m-0 text-base font-extrabold text-[#1E251C]">Video đang được xử lý</p>
      <p class="m-0 mt-2 text-sm text-[#5A6655] leading-relaxed max-w-md mx-auto">
        Video này đã được đăng nhưng chưa xử lý xong. Vui lòng quay lại sau ít phút.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { attachHlsStream, detachHlsStream } from '~/composables/useHlsVideo'
import { attachPlyrPlayer, detachPlyrPlayer, type HlsQualityBridge } from '~/composables/usePlyrPlayer'
import type { PublicMediaItem } from '~/types/public-api'

const props = defineProps<{
  /**
   * Mục media đã qua `serializePublicMedia` ở máy chủ.
   *
   * Nhận cả mục thay vì một slug rồi tự fetch: trang chi tiết **đã có** mục này
   * trong tay, và một lượt fetch thứ hai cho cùng một hàng là một lượt nữa để
   * lệch nhau — trình phát có thể dựng từ một bản ghi cũ hơn tiêu đề ngay trên
   * nó. Không có lượt gọi mạng nào trong tệp này.
   */
  item: PublicMediaItem
}>()

const videoEl = ref<HTMLVideoElement | null>(null)
const playerPending = ref(false)
const playerError = ref('')
const hlsInstance = ref<{ destroy: () => void } | null>(null)
// Plyr wrap `<video>` element cho UI đẹp hơn native controls (nút tua ±10s, thanh
// tua, tốc độ, phím tắt, menu chất lượng khi HLS có nhiều bản). Khởi tạo SAU khi
// source đã gán (file) hoặc hls.js đã attach + manifest parse (hls), để Plyr
// đọc media qua element và biết các bản có sẵn. Dọn ở `onBeforeUnmount` cùng hls.
const plyrInstance = ref<{ destroy: () => void } | null>(null)
// Cầu chất lượng HLS — populate khi `MANIFEST_PARSED` fire, dùng khi khởi tạo Plyr.
// `null` cho passthrough mp4 (không có levels) → Plyr ẩn menu chất lượng.
const hlsQualityBridge = ref<HlsQualityBridge | null>(null)

onMounted(async () => {
  const url = props.item.streamUrl
  if (props.item.source !== 'upload' || !url) return

  const video = videoEl.value
  if (!video) return

  // Passthrough (`MEDIA_AUTO_TRANSCODE=false`, không rendition): stream endpoint
  // phục vụ tệp gốc `original.<ext>` trực tiếp qua byte-range — không phải HLS.
  // hls.js đi parse URL như một manifest và không phát được mp4; trình duyệt phát
  // mp4 gốc qua `<video src>` nhanh hơn và tin cậy hơn, nên nhánh này tránh hẳn
  // thư viện. `streamKind='file'` là tín hiệu từ máy chủ: `resolutionsReady` rỗng.
  if (props.item.streamKind === 'file') {
    video.src = url
    // Plyr wrap element đã có mp4 source — UI đẹp (nút tua ±10s, tốc độ), không
    // có menu chất lượng vì chỉ một bản (đúng hành vi — không có gì để chọn).
    await initPlyr()
    return
  }

  playerPending.value = true

  // **Khởi tạo Plyr TRƯỚC khi hls.js attach.** Plyr wrap `<video>` element và giữ
  // nguyên element (không re-create), nhưng nếu hls.js đã gán `blob:` URL
  // (MediaSource) cho `video.src` rồi Plyr mới wrap, Plyr có thể `load()` nội bộ
  // và tạm detach MediaSource → trình duyệt báo `blob: ERR_FILE_NOT_FOUND`.
  // Thứ tự Plyr-rồi-hls là cách plyr khuyên cho hls.js: Plyr wrap video trống,
  // rồi hls.js attach MediaSource vào đúng element bên trong.
  await initPlyr()

  const result = await attachHlsStream(video, url, {
    instance: hlsInstance,
    onFatalError: () => {
      playerError.value = 'Không phát được video. Vui lòng thử tải lại trang.'
    },
    // Đợi manifest parse xong rồi populate menu chất lượng cho Plyr. Plyr đã
    // khởi tạo sẵn (vừa trên), nên ở đây chỉ cập nhật bridge + vẽ lại menu.
    onManifestParsed: (parsed) => {
      hlsQualityBridge.value = {
        getLevels: () => parsed.levels,
        setLevel: parsed.setLevel,
      }
      // Plyr đã init nhưng menu quality rỗng (bridge null lúc init) → cập nhật
      // menu dynamic bằng cách set lại quality options qua API Plyr.
      updatePlyrQualityMenu()
    },
  })

  if (!result.ok) {
    playerError.value = result.reason === 'unsupported'
      ? 'Trình duyệt của bạn không hỗ trợ phát video này. Vui lòng dùng trình duyệt khác.'
      : 'Không tải được trình phát. Vui lòng kiểm tra kết nối mạng và thử lại.'
    playerPending.value = false
  }
  if (result.ok && result.mode === 'native') {
    // Safari: native HLS, không có levels để populate menu (menu chất lượng ẩn).
    playerPending.value = false
  }
})

/** Khởi tạo Plyr; thất bại ghi lỗi nhưng không chặn phát (native controls dự phòng). */
async function initPlyr() {
  const video = videoEl.value
  if (!video) return
  const res = await attachPlyrPlayer(video, {
    instance: plyrInstance,
    hlsQuality: hlsQualityBridge.value ?? undefined,
  })
  playerPending.value = false
  if (!res.ok) {
    console.warn('Plyr không tải được, dùng native controls.')
  }
}

/**
 * Cập nhật menu chất lượng Plyr sau khi hls.js parse manifest (levels đã biết).
 * Plyr đã init với menu rỗng (bridge null), giờ có levels → xây lại menu.
 */
function updatePlyrQualityMenu() {
  const inst = plyrInstance.value as unknown as {
    quality?: {
      options?: number[]
      forced?: boolean
      onChange?: (selected: number) => void
    }
  } | null
  if (!inst?.quality) return
  const levels = hlsQualityBridge.value?.getLevels() ?? null
  inst.quality.options = levels && levels.length > 1
    ? [0, ...levels.slice().sort((a, b) => a - b)]
    : []
  inst.quality.forced = true
  inst.quality.onChange = (selected: number) => {
    hlsQualityBridge.value?.setLevel(selected === 0 ? -1 : selected)
  }
}

onBeforeUnmount(() => {
  // Xoá `src` **đầu tiên**: hls.js gán `blob:` URL (MediaSource) cho `video.src`.
  // Khi Plyr `destroy()` hoặc hls.js `destroy()` chạy, chúng revoke blob đó, và
  // nếu `video.src` vẫn trỏ tới blob, trình duyệt ném `ERR_FILE_NOT_FOUND`. Xoá
  // `src` + `load()` trước để element không còn tham chiếu tới blob khi các thư
  // viện thu hồi nó.
  const video = videoEl.value
  if (video) {
    video.pause()
    video.removeAttribute('src')
    video.load()
  }
  // Plyr trước hls: Plyr wrap `<video>` và đọc media qua nó. Nếu hls destroy
  // trước, MediaSource bị đóng trong khi Plyr vẫn còn listener → lỗi. Dồn Plyr
  // xong rồi mới hls.
  detachPlyrPlayer(plyrInstance)
  detachHlsStream(hlsInstance)
})
</script>
