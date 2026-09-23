<!--
  Thanh thông báo phát trực tiếp — nằm **trong** header sticky để dính theo khi
  cuộn. Chỉ một dòng text duy nhất, căn giữa, không lặp marquee.

  ## Vì sao tách riêng và tự hỏi trạng thái

  `/media` phục vụ qua `swr: 60`. Một buổi phát có thể bắt đầu/kết thúc bên trong
  cửa sổ đó, nên HTML dựng phía máy chủ **không được** mang thông tin này. Component
  này tự hỏi `/api/public/livestream/active` **sau mount**, đúng như `LiveHero.vue`.

  `LiveHero` và `LiveTickerBar` cùng hỏi một endpoint, cùng poll 8 giây — cố ý
  tách: thanh thông báo là tiện ích phụ, hỏng không được làm hỏng khối hero chính.
-->
<template>
  <NuxtLink
    v-if="session && !isOnMedia"
    to="/media"
    class="group relative block bg-[#1a2e1c] no-underline transition-colors hover:bg-[#213926]"
    role="status"
    aria-label="Thông báo buổi phát trực tiếp — bấm để xem"
  >
    <div class="container relative flex items-center justify-between gap-3 py-1.5 sm:py-[7px]">
      <!-- Cụm trái: Badge + Tiêu đề -->
      <div class="flex items-center gap-2 min-w-0 flex-1">
        <span class="inline-flex items-center gap-1.5 px-2 py-[3px] rounded bg-[#C62828] text-white text-[0.65rem] font-extrabold uppercase tracking-wider shrink-0">
          <span class="w-[5px] h-[5px] rounded-full bg-white animate-pulse motion-reduce:animate-none" aria-hidden="true"></span>
          Live
        </span>
        <!-- PC: truncate. Mobile: ticker chạy ngang -->
        <div class="min-w-0 flex-1 overflow-hidden">
          <span class="hidden truncate text-white/90 text-[0.8rem] font-medium sm:block group-hover:text-white transition-colors">
            {{ session.title }}
          </span>
          <span class="block overflow-hidden text-[0.76rem] font-medium text-white/90 sm:hidden">
            <span class="inline-block whitespace-nowrap animate-[ticker_18s_linear_infinite]" aria-hidden="true">
              {{ session.title }}&nbsp;&nbsp;&nbsp;&nbsp;&bull;&nbsp;&nbsp;&nbsp;&nbsp;{{ session.title }}&nbsp;&nbsp;&nbsp;&nbsp;&bull;&nbsp;&nbsp;&nbsp;&nbsp;
            </span>
          </span>
        </div>
      </div>

      <!-- Cụm phải: thời gian + nút Xem -->
      <div class="flex items-center gap-2 shrink-0">
        <span v-if="startedLabel" class="hidden sm:inline-flex items-center gap-1 text-white/50 text-[0.7rem] whitespace-nowrap">
          <i class="fa-regular fa-clock text-[0.6rem]" aria-hidden="true"></i>
          {{ startedLabel }}
        </span>
        <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#7CB342] text-[#122815] text-[0.68rem] font-bold transition-colors group-hover:bg-[#8BC34A]">
          Xem ngay
          <i class="fa-solid fa-arrow-right text-[0.55rem]" aria-hidden="true"></i>
        </span>
      </div>
    </div>
  </NuxtLink>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
/** Ẩn ticker khi đang ở chính trang /media — ở đó LiveHero đã hiển thị buổi phát. */
const isOnMedia = computed(() => route.path === '/media' || route.path.startsWith('/media/'))

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

const startedLabel = computed(() => {
  const v = session.value?.startedAt
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
})

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
    const value = response.session
    if (value.source === 'youtube' && !value.embedUrl) {
      session.value = null
      return
    }
    session.value = value
  } catch {
    session.value = null
  }
}

const ACTIVE_POLL_MS = 8_000
let activePollTimer: number | undefined

onMounted(() => {
  void loadActive()
  activePollTimer = window.setInterval(() => { void loadActive() }, ACTIVE_POLL_MS)
})
onBeforeUnmount(() => {
  if (activePollTimer) window.clearInterval(activePollTimer)
})
</script>
