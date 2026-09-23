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
    class="group relative block overflow-hidden bg-gradient-to-r from-[#122214] via-[#1a331d] to-[#122214] border-y border-[#26442b]/80 no-underline transition-all hover:from-[#162a19] hover:via-[#203e24] hover:to-[#162a19]"
    role="status"
    aria-label="Thông báo buổi phát trực tiếp — bấm để xem"
  >
    <div class="container relative flex items-center justify-between gap-3 py-1.5 sm:py-2">
      <!-- Cụm trái: Badge Trực tiếp + Phân cách + Tiêu đề -->
      <div class="flex items-center gap-2.5 min-w-0 flex-1">
        <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-gradient-to-r from-[#D32F2F] to-[#E53935] text-white text-[0.68rem] sm:text-[0.7rem] font-black uppercase tracking-wider shrink-0 shadow-[0_0_10px_rgba(229,57,53,0.45)]">
          <span class="w-1.5 h-1.5 rounded-full bg-white animate-pulse motion-reduce:animate-none" aria-hidden="true"></span>
          <span class="leading-none">Trực tiếp</span>
        </span>
        <span class="w-px h-3.5 bg-white/20 shrink-0 hidden sm:inline-block" aria-hidden="true"></span>
        <!-- Tiêu đề buổi phát: truncate trên PC, ticker trên mobile -->
        <div class="min-w-0 flex-1 overflow-hidden">
          <span class="hidden truncate text-white/95 text-[0.82rem] font-semibold tracking-wide sm:block group-hover:text-white transition-colors">
            {{ session.title }}
          </span>
          <span class="block overflow-hidden text-[0.78rem] font-semibold text-white/95 sm:hidden">
            <span class="inline-block whitespace-nowrap animate-[ticker_18s_linear_infinite]" aria-hidden="true">
              {{ session.title }}&nbsp;&nbsp;&nbsp;&nbsp;&bull;&nbsp;&nbsp;&nbsp;&nbsp;{{ session.title }}&nbsp;&nbsp;&nbsp;&nbsp;&bull;&nbsp;&nbsp;&nbsp;&nbsp;
            </span>
          </span>
        </div>
      </div>

      <!-- Cụm phải: Thời gian bắt đầu + nút hành động Xem ngay -->
      <div class="flex items-center gap-2.5 shrink-0">
        <span v-if="startedLabel" class="hidden sm:inline-flex items-center gap-1.5 text-white/65 text-[0.72rem] font-medium whitespace-nowrap">
          <i class="fa-regular fa-clock text-[0.68rem] text-white/45" aria-hidden="true"></i>
          <span>{{ startedLabel }}</span>
        </span>
        <span class="inline-flex items-center gap-1 px-2.5 sm:px-3 py-1 rounded-full bg-white/10 group-hover:bg-[#7CB342] text-white group-hover:text-[#122815] text-[0.7rem] sm:text-[0.72rem] font-bold tracking-wide transition-all shadow-sm">
          <span>Xem ngay</span>
          <i class="fa-solid fa-arrow-right text-[0.6rem] transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true"></i>
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
