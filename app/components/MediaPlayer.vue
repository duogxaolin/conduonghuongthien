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

onMounted(async () => {
  const url = props.item.streamUrl
  if (props.item.source !== 'upload' || !url) return

  const video = videoEl.value
  if (!video) return

  playerPending.value = true
  const result = await attachHlsStream(video, url, {
    instance: hlsInstance,
    onFatalError: () => {
      playerError.value = 'Không phát được video. Vui lòng thử tải lại trang.'
    },
  })
  playerPending.value = false

  if (result.ok) return
  playerError.value = result.reason === 'unsupported'
    ? 'Trình duyệt của bạn không hỗ trợ phát video này. Vui lòng dùng trình duyệt khác.'
    : 'Không tải được trình phát. Vui lòng kiểm tra kết nối mạng và thử lại.'
})

onBeforeUnmount(() => detachHlsStream(hlsInstance))
</script>
