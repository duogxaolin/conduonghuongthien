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
      class="relative overflow-hidden border-b border-[#F0C8C8] bg-gradient-to-br from-[#FDF2F2] via-white to-[#F8FAF7]"
    >
      <div class="container relative pt-8 sm:pt-10 pb-8">
        <nav aria-label="Đường dẫn trang" class="flex items-center gap-2 text-xs text-[#7A8A76] mb-4">
          <nuxt-link to="/" class="hover:text-[#4A6741] transition-colors flex items-center gap-1.5 no-underline text-[#556450]">
            <i class="fa-solid fa-house text-[0.7rem]" aria-hidden="true"></i>
            <span>Trang chủ</span>
          </nuxt-link>
          <span class="text-[#BAC8B6]">&rsaquo;</span>
          <span class="text-[#2D5A27] font-bold">Thư viện Video</span>
        </nav>

        <div class="flex flex-wrap items-center gap-3 mb-3">
          <!--
            Chấm "TRỰC TIẾP" — đây là một **chỉ báo trạng thái**, không phải khung
            chờ. Nhịp đập là tín hiệu duy nhất nó mang: tắt chuyển động đi thì còn
            lại một chấm đỏ không nói lên điều gì. Cùng nhóm được miễn trừ đã ghi
            trong `tests/skeleton-loading-ui.test.ts` (bốn nhịp đập chỉ báo trạng
            thái). `motion-reduce:animate-none` **không** gắn ở đây là chủ đích,
            nhưng nhịp này phải được ghi danh — xem báo cáo.
          -->
          <span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#D32F2F] text-white text-[0.72rem] font-extrabold uppercase tracking-wide">
            <span class="w-2 h-2 rounded-full bg-white animate-pulse" aria-hidden="true"></span>
            Đang phát trực tiếp
          </span>
          <span v-if="startedLabel" class="text-xs text-[#7A8A76] font-medium inline-flex items-center gap-1.5">
            <i class="fa-regular fa-clock" aria-hidden="true"></i>
            Bắt đầu {{ startedLabel }}
          </span>
        </div>

        <h1 class="text-[1.5rem] sm:text-[1.9rem] font-extrabold text-[#1E251C] leading-[1.25] m-0 max-w-3xl">
          {{ session.title }}
        </h1>
        <p
          v-if="session.description"
          class="text-[0.95rem] text-[#5A6655] mt-2 mb-0 leading-relaxed max-w-3xl whitespace-pre-line break-words"
        >{{ session.description }}</p>

        <div class="mt-5">
          <!-- Nguồn ngoài: nhúng thẳng miền không cookie do máy chủ dựng sẵn.
               Không nạp thư viện nào — xem `MediaPlayer.vue` cho lý do đầy đủ. -->
          <div v-if="session.embedUrl" class="relative w-full aspect-video bg-black rounded-xl overflow-hidden shadow-sm max-w-4xl">
            <iframe
              :src="session.embedUrl"
              :title="session.title"
              class="absolute inset-0 w-full h-full border-0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerpolicy="strict-origin-when-cross-origin"
              allowfullscreen
            ></iframe>
          </div>

          <!-- Buổi phát tự lưu trữ: HLS qua chính composable mà `MediaPlayer.vue`
               dùng. Hai bản sao của phép nạp `hls.js` là hai chỗ để lệch nhau về
               đúng thứ quan trọng nhất — thư viện chỉ được nạp sau khi mount. -->
          <div v-else class="relative w-full aspect-video bg-black rounded-xl overflow-hidden shadow-sm max-w-4xl">
            <video
              ref="videoEl"
              class="absolute inset-0 w-full h-full"
              controls
              playsinline
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

          <p v-if="playerError" role="alert" class="mt-3 mb-0 text-sm text-[#B04A4A] font-semibold inline-flex items-center gap-2">
            <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
            {{ playerError }}
          </p>

          <div class="mt-6 h-[28rem] max-w-4xl overflow-hidden rounded-xl border border-[#DDE6DE] bg-white shadow-sm">
            <LiveChat :active="Boolean(session)" />
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

  if (result.ok) return
  playerError.value = result.reason === 'unsupported'
    ? 'Trình duyệt của bạn không hỗ trợ xem trực tiếp. Vui lòng dùng trình duyệt khác.'
    : 'Không kết nối được buổi phát. Vui lòng tải lại trang.'
}, { flush: 'post' })

const ACTIVE_POLL_MS = 15_000
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
