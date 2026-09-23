<!--
  Hero của Thư viện Video: tự hỏi trạng thái buổi phát, và **tự lùi về hero mặc
  định** khi không có buổi phát nào hoặc khi lượt hỏi hỏng.

  ## Vì sao hỏi ở đây mà không ở trang

  Trang danh sách có bốn nhánh trạng thái riêng (đang tải / lỗi / rỗng / có dữ
  liệu) cho **danh sách video**. Trạng thái buổi phát là một trục độc lập: danh
  sách có thể đang hỏng trong khi buổi phát vẫn đang chạy, và ngược lại. Trộn hai
  trục đó vào một cờ `pending` của trang là buộc chúng phải hỏng cùng lúc — và
  nhánh hỏng thường gặp nhất là một buổi phát **không hiện ra** vì danh sách video
  bên dưới lỗi.

  ## Vì sao hỏi SAU mount

  `/media` phục vụ qua `swr: 60`. Một buổi phát có thể bắt đầu hoặc kết thúc bên
  trong cửa sổ 60 giây đó, nên trạng thái này phải đến từ trình duyệt, không được
  nằm trong HTML đệm. Cùng lý do `active.get.ts` đặt `Cache-Control: no-store`.

  ## Mọi nhánh hỏng đều lùi về hero mặc định

  Đây là quy tắc bao trùm của khối này: **không có nhánh nào làm trống đầu trang**.
  Một lượt hỏi hỏng, một phản hồi `ok: false`, hay một buổi phát không có nguồn
  phát được — tất cả đều cho ra hero mặc định, vì một đầu trang trống đọc ra là
  "cổng bị hỏng" trong khi sự thật chỉ là "hiện chưa có buổi phát".

  Cố ý **không** hiện cảnh báo lỗi ở đây. Không có gì để người đọc làm với nó —
  khác một danh sách hỏng, nơi có nút thử lại và một hành động rõ ràng. Một khối
  đỏ ở đầu trang cho một tiện ích phụ chỉ làm người đọc nghĩ cả trang hỏng.
-->
<template>
  <div>
    <section
      v-if="session"
      class="bg-[#0c140d] border-b border-[#1b2b1d] py-2 sm:py-2.5 lg:py-3"
    >
      <div class="w-full px-2 sm:px-4 lg:px-6">
        <!-- Khung phát trực tiếp chuẩn Rạp chiếu phim (Theater Mode):
             Tràn rộng toàn màn hình, khống chế chiều cao theo viewport để vừa vặn trong tầm mắt,
             không bị trống 2 bên hông và không bao giờ phải cuộn chuột. -->
        <div class="bg-[#080d08] border border-[#1e3020] rounded-xl lg:rounded-2xl overflow-hidden shadow-2xl shadow-black/60 flex flex-col lg:h-[calc(100dvh-185px)]">
          <!-- Thanh metadata: badge Trực tiếp + Tiêu đề + Thời gian bắt đầu -->
          <div class="px-3.5 sm:px-4 lg:px-5 py-2 sm:py-2.5 bg-[#111c12] border-b border-[#1c2d1e] flex items-center gap-3 shrink-0">
            <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-[4px] bg-[#D32F2F] text-white text-[0.68rem] sm:text-[0.7rem] font-black uppercase tracking-wider shrink-0 shadow-sm">
              <span class="w-1.5 h-1.5 rounded-full bg-white animate-pulse motion-reduce:animate-none" aria-hidden="true"></span>
              Trực tiếp
            </span>
            <h1 class="text-sm sm:text-base font-extrabold text-white leading-tight tracking-tight m-0 min-w-0 truncate flex-1">
              {{ session.title }}
            </h1>
            <span v-if="startedLabel" class="text-[0.72rem] text-white/70 font-medium inline-flex items-center gap-1.5 shrink-0 bg-white/5 px-2.5 py-0.5 rounded-md border border-white/10">
              <i class="fa-regular fa-clock text-[0.68rem] text-white/50" aria-hidden="true"></i>
              {{ startedLabel }}
            </span>
          </div>

          <!-- Player + chat grid: PC: player chiếm trọn không gian bên trái, chat dock phải (340px).
               Mobile: stack dọc.
               Chiều cao grid co giãn flex-1 để khớp chính xác card height. -->
          <div class="flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_340px] flex-1 min-h-0 gap-0">
            <!-- Cột player — nền đen, căn giữa video 16:9, tự động co giãn tối đa mà không tràn -->
            <div class="min-w-0 min-h-0 bg-black flex items-center justify-center relative overflow-hidden h-[56.25vw] max-h-[500px] lg:h-full lg:max-h-none">
              <div
                v-if="session.embedUrl"
                class="relative w-full aspect-video max-w-full max-h-full flex items-center justify-center"
              >
                <iframe
                  :src="autoplayEmbedUrl"
                  :title="session.title"
                  class="absolute inset-0 w-full h-full border-0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  referrerpolicy="strict-origin-when-cross-origin"
                  allowfullscreen
                ></iframe>
              </div>

              <div
                v-else
                class="relative w-full aspect-video max-w-full max-h-full flex items-center justify-center"
              >
                <video
                  ref="videoEl"
                  class="absolute inset-0 w-full h-full"
                  controls
                  playsinline
                  autoplay
                  preload="metadata"
                ></video>
                <div
                  v-if="playerPending"
                  role="status"
                  aria-busy="true"
                  class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 text-white"
                >
                  <span class="sr-only">Đang chuẩn bị trình phát trực tiếp</span>
                  <i class="fa-solid fa-circle-notch fa-spin text-2xl" aria-hidden="true"></i>
                  <span class="text-sm font-semibold">Đang kết nối buổi phát…</span>
                </div>
              </div>

              <p
                v-if="playerError"
                role="alert"
                class="px-4 py-3 mb-0 text-sm text-[#ff6b6b] font-semibold inline-flex items-center gap-2 bg-[#1a0d0d] absolute bottom-4 left-4 right-4 z-10 rounded-lg border border-[#ff6b6b]/30"
              >
                <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                {{ playerError }}
              </p>
            </div>

            <!-- Cột chat — dark panel dock phải, inline. Mobile: stack dưới player. -->
            <aside class="bg-[#111a11] border-t lg:border-t-0 lg:border-l border-[#1f2a1c] flex flex-col min-h-[280px] lg:h-full lg:min-h-0 lg:overflow-hidden">
              <div class="flex items-center justify-between px-3.5 py-2.5 border-b border-[#1f2a1c] shrink-0 bg-[#0e170e]">
                <div class="flex items-center gap-2 text-white/90">
                  <i class="fa-solid fa-comments text-sm text-[#7CB342]" aria-hidden="true"></i>
                  <span class="text-xs sm:text-sm font-bold">Trò chuyện trực tiếp</span>
                </div>
                <span class="inline-flex items-center gap-1.5 text-[0.7rem] text-[#7CB342] font-semibold bg-[#7CB342]/10 px-2.5 py-0.5 rounded-full border border-[#7CB342]/20">
                  <span class="w-1.5 h-1.5 rounded-full bg-[#7CB342] animate-pulse motion-reduce:animate-none" aria-hidden="true"></span>
                  Live
                </span>
              </div>
              <div class="flex-1 min-h-0">
                <LiveChat :active="Boolean(session)" />
              </div>
            </aside>
          </div>
        </div>
      </div>
    </section>

    <!--
      Mọi nhánh còn lại — chưa hỏi xong, hỏi hỏng, `ok: false`, không có buổi phát,
      hoặc buổi phát không có nguồn phát được — đều cho ra hero mặc định.

      Gộp cả nhánh "chưa hỏi xong" vào đây là chủ đích: hiện một khung xương ở đầu
      trang rồi thay nó bằng hero mặc định trong đa số lượt tải (khi không có buổi
      phát nào) là một cú nhấp nháy không mang thông tin gì. Hero mặc định **là**
      trạng thái đúng của phần lớn thời gian.
    -->
    <MediaDefaultHero v-else :description="description" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { attachHlsStream, detachHlsStream } from '~/composables/useHlsVideo'
import { formatDateVN } from '~/utils/formatDate'

withDefaults(defineProps<{
  /** Chuyển tiếp xuống hero mặc định khi không có buổi phát. */
  description?: string
}>(), {
  description: undefined,
})

type ActiveSession = {
  id: number
  title: string
  description: string | null
  source: string
  embedUrl: string | null
  streamUrl: string
  thumbnailUrl: string | null
  startedAt: string | null
}

const session = ref<ActiveSession | null>(null)
const videoEl = ref<HTMLVideoElement | null>(null)
const playerPending = ref(false)
const playerError = ref('')
const hlsInstance = ref<{ destroy: () => void } | null>(null)

const startedLabel = computed(() => (session.value?.startedAt ? formatDateVN(session.value.startedAt) : ''))

/**
 * URL embed YouTube với `autoplay=1` — full tiếng.
 *
 * Trình duyệt có thể chặn autoplay có tiếng nếu người dùng chưa tương tác trang.
 * Nếu bị chặn, player dừng ở frame đầu; khách bấm play là có tiếng ngay. Không
 * mute: anh yêu muốn livestream vào là nghe, đây là sự kiện đang diễn ra.
 *
 * Chỉ áp cho LiveHero (livestream), không áp cho VOD trong thư viện video.
 */
const autoplayEmbedUrl = computed(() => {
  const url = session.value?.embedUrl
  if (!url) return undefined
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}autoplay=1`
})

/**
 * Hỏi trạng thái sau mount và theo chu kỳ vừa phải.  Một lượt dừng phải gỡ hero
 * và phòng chat đang hiển thị, kể cả khi khung SSE bị mạng trung gian cắt mất.
 *
 * `retry: 0` và `timeout`: đây là tiện ích phụ của một trang đã có nội dung riêng.
 * Để mặc định thì một máy chủ chậm giữ lượt hỏi này treo lâu hơn cả lượt tải danh
 * sách chính.
 *
 * Mọi lỗi bị nuốt — `session` ở lại `null`, và hero mặc định hiện ra.
 */
async function loadActive() {
  try {
    const response = await $fetch<{ ok: boolean, active: boolean, session: ActiveSession | null }>(
      '/api/public/livestream/active',
      { retry: 0, timeout: 4000 },
    )
    if (!response?.ok || !response.active || !response.session) {
      session.value = null
      return
    }
    // Một buổi phát không có nguồn phát được (nguồn ngoài mà định danh hỏng) không
    // được dựng thành hero "đang phát" với một khung trống bên dưới.
    const value = response.session
    if (value.source === 'youtube' && !value.embedUrl) {
      session.value = null
      return
    }
    session.value = value
  } catch {
    // The old session is no longer trustworthy after a failed status check.
    session.value = null
  }
}

/**
 * Gắn luồng khi hero xuất hiện, và gỡ khi nó biến mất.
 *
 * `watch` chứ không `onMounted`: thẻ `<video>` chỉ tồn tại **sau** lượt hỏi trạng
 * thái, nên lúc mount `videoEl` còn `null`. Đây đúng là cái bẫy mà một bản viết
 * theo phản xạ sẽ mắc — `onMounted` chạy, `videoEl.value` là `null`, hàm thoát
 * sớm, và hero hiện ra với một khung đen không có gì giải thích.
 *
 * `flush: 'post'` để callback chạy **sau** khi Vue đã gắn phần tử vào DOM; mặc
 * định `'pre'` sẽ chạy trước lượt cập nhật, tức là trước khi thẻ `<video>` tồn tại.
 */
watch(session, async value => {
  detachHlsStream(hlsInstance)
  playerError.value = ''
  if (!value || value.source === 'youtube') return

  const video = videoEl.value
  if (!video) return

  playerPending.value = true
  const result = await attachHlsStream(video, value.streamUrl, {
    instance: hlsInstance,
    onFatalError: () => {
      playerError.value = 'Buổi phát bị gián đoạn. Vui lòng tải lại trang.'
    },
  })
  playerPending.value = false

  if (result.ok) {
    // Autoplay muted — `<video muted autoplay>` đã khai ở template, nhưng hls.js
    // attach sau khi thẻ mounted nên cần `.play()` rõ. Nuốt lỗi: Chrome đôi khi vẫn
    // từ chối nếu user chưa tương tác trang, và đó không phải lỗi của buổi phát.
    video.play().catch(() => {})
    return
  }
  playerError.value = result.reason === 'unsupported'
    ? 'Trình duyệt của bạn không hỗ trợ xem trực tiếp. Vui lòng dùng trình duyệt khác.'
    : 'Không kết nối được buổi phát. Vui lòng tải lại trang.'
}, { flush: 'post' })

const ACTIVE_POLL_MS = 8_000
let activePollTimer: number | undefined

onMounted(() => {
  void loadActive()
  activePollTimer = window.setInterval(() => { void loadActive() }, ACTIVE_POLL_MS)
})
onBeforeUnmount(() => {
  if (activePollTimer) window.clearInterval(activePollTimer)
  detachHlsStream(hlsInstance)
})
</script>
