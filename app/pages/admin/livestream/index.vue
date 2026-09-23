<script setup lang="ts">
/**
 * Trang quản trị Livestream.
 *
 * ## Vì sao đọc trạng thái từ `/api/public/livestream/active`
 *
 * Không có endpoint quản trị `GET /api/admin/livestream/active` chưa được viết.
 * `getActiveLivestream` là service dùng chung, và `active.get.ts` công khai đã
 * trả cùng dữ liệu (tiêu đề, nguồn, embed URL, startedAt) mà trang quản trị
 * cần — đọc cookie người đọc là bị cấm tường minh ở endpoint đó, nên không có
 * lý do bảo mật nào để dùng version quản trị riêng. Trang này gọi endpoint
 * công khai từ trình duyệt sau mount (không `useFetch`, không SSR) vì buổi phát
 * có thể bắt đầu hoặc kết thúc bất cứ lúc nào — giống `LiveHero.vue`.
 *
 * ## Bắt đầu / Dừng
 *
 * `start.post.ts` nhận `{ title, description?, source, youtubeVideoId?,
 * storagePath?, thumbnailUrl? }` và trả `201 { ok, sessionId }`. `stop.post.ts`
 * nhận `{ sessionId }` trong thân. Hai quyền RBAC tách biệt: `livestream/create`
 * để bắt đầu, `livestream/update` để dừng.
 *
 * ## Kiểm duyệt chat
 *
 * Lịch sử của phiên đang phát vốn đã là dữ liệu công khai và endpoint public chỉ
 * trả các trường đó. Trang dùng nó để một cán bộ thấy đúng các tin người xem đang
 * thấy; thao tác gỡ vẫn đi qua endpoint admin và bị chặn bằng
 * `livestream/delete`. Không nhận session id từ trình duyệt: `history.get.ts`
 * tự giải phiên đang phát, rồi trang đối chiếu lại id trước khi hiển thị.
 *
 * ## Hợp đồng tải / lỗi
 *
 * Ba nhánh — `loading` / `loadError` / dữ liệu — theo cùng quy tắc mọi trang
 * admin: nhánh lỗi mang `role="alert"`, nút "Thử lại" gọi `loadActive()` khai
 * báo trong cùng tệp, không tải lại trang.
 */
import type { AdminLivestreamActive } from '~/types/admin-api'

definePageMeta({
  layout: 'admin',
  middleware: 'admin-auth'
})

const toast = useToast()
const { hasPermission } = useAdminAuth()

interface LiveSession {
  id:          number
  title:        string
  description:  string | null
  source:       string
  embedUrl:     string | null
  streamUrl:    string
  thumbnailUrl: string | null
  startedAt:    string | null
}

interface LiveChatMessage {
  id: number
  displayName: string
  content: string
  createdAt: string
}

const loading = ref(true)
const loadError = ref('')
const activeSession = ref<LiveSession | null>(null)

const canStart = hasPermission('livestream', 'create')
const canStop  = hasPermission('livestream', 'update')
const canModerateChat = hasPermission('livestream', 'delete')

const chatMessages = ref<LiveChatMessage[]>([])
const chatLoading = ref(false)
const chatError = ref('')
const removingMessageId = ref<number | null>(null)

// ─── Start form ─────────────────────────────────────────────────────────────
const startForm = ref({
  title:          '',
  description:     '',
  source:          'youtube' as 'youtube' | 'upload',
  youtubeVideoId:  '',
  storagePath: '',
})
const isStarting = ref(false)

// ─── YouTube metadata fetch (oEmbed) ────────────────────────────────────────
// Cán bộ dán link YouTube Live → bấm "Lấy thông tin" → máy chủ hỏi oEmbed, điền
// sẵn tiêu đề + hiện preview thumbnail. Tiêu đề chỉ điền khi đang rỗng — không
// ghi đè tiêu đề VN hoá cán bộ đã tự gõ. Cùng pattern `MediaPortalForm.vue`.
const fetchingMeta = ref(false)
const metaError = ref('')
const previewTitle = ref('')
const previewAuthor = ref('')
const previewThumb = ref('')

async function fetchMeta() {
  if (!startForm.value.youtubeVideoId.trim() || fetchingMeta.value) return
  fetchingMeta.value = true
  metaError.value = ''
  try {
    const res = await $fetch<{ ok: boolean, reason?: string, title?: string, authorName?: string, thumbnailUrl?: string, videoId?: string }>(
      '/api/admin/media-portal/youtube-meta',
      { method: 'POST', body: { url: startForm.value.youtubeVideoId.trim() } },
    )
    if (!res.ok) {
      metaError.value = res.reason === 'invalid'
        ? 'Địa chỉ video không hợp lệ hoặc không được hỗ trợ.'
        : 'Không lấy được thông tin từ YouTube. Kiểm tra lại liên kết hoặc thử lại.'
      previewTitle.value = ''
      previewAuthor.value = ''
      previewThumb.value = ''
      return
    }
    // Chỉ điền tiêu đề khi đang rỗng — không ghi đè tiêu đề cán bộ đã tự gõ.
    if (!startForm.value.title.trim() && res.title) startForm.value.title = res.title
    previewTitle.value = res.title ?? ''
    previewAuthor.value = res.authorName ?? ''
    previewThumb.value = res.thumbnailUrl ?? ''
    // Chuẩn hoá thẳng từ URL sang ID — tránh paste lại.
    if (res.videoId) startForm.value.youtubeVideoId = res.videoId
  } catch (err: unknown) {
    metaError.value = errorMessage(err, 'Không lấy được thông tin từ YouTube.')
    previewTitle.value = ''
    previewAuthor.value = ''
    previewThumb.value = ''
  } finally {
    fetchingMeta.value = false
  }
}

// ─── Stop ────────────────────────────────────────────────────────────────────
const isStopping = ref(false)

async function loadActive() {
  loading.value = true
  loadError.value = ''
  try {
    const res = await $fetch<AdminLivestreamActive>('/api/public/livestream/active')
    if (res.ok === false) {
      loadError.value = 'Không tải được trạng thái buổi phát.'
      return
    }
    activeSession.value = res.active && res.session ? {
      id:          res.session.id,
      title:       res.session.title,
      description: res.session.description,
      source:      res.session.source,
      embedUrl:    res.session.embedUrl,
      streamUrl:   res.session.streamUrl,
      thumbnailUrl:res.session.thumbnailUrl,
      startedAt:   res.session.startedAt,
    } : null
    await loadChatMessages(activeSession.value?.id)
  } catch (err: unknown) {
    activeSession.value = null
    chatMessages.value = []
    loadError.value = errorMessage(err, 'Không tải được trạng thái buổi phát.')
  } finally {
    loading.value = false
  }
}

async function loadChatMessages(expectedSessionId?: number) {
  chatMessages.value = []
  chatError.value = ''
  if (!expectedSessionId) return

  chatLoading.value = true
  try {
    const res = await $fetch<{ ok: boolean, sessionId: number | null, messages: LiveChatMessage[] }>('/api/public/livestream/chat/history', {
      query: { limit: 100 },
    })
    // A stop/start can happen between the two requests.  Never show the old
    // room's messages under the new session card.
    if (activeSession.value?.id !== expectedSessionId || res.sessionId !== expectedSessionId) return
    chatMessages.value = res.messages
  } catch (err: unknown) {
    if (activeSession.value?.id === expectedSessionId) {
      chatError.value = errorMessage(err, 'Không tải được tin nhắn trực tiếp.')
    }
  } finally {
    chatLoading.value = false
  }
}

async function removeChatMessage(message: LiveChatMessage) {
  if (!canModerateChat || removingMessageId.value !== null) return
  if (!confirm(`Gỡ tin nhắn của ${message.displayName}?`)) return

  removingMessageId.value = message.id
  try {
    await $fetch(`/api/admin/livestream/chat/${message.id}`, { method: 'DELETE' })
    chatMessages.value = chatMessages.value.filter(item => item.id !== message.id)
    toast.success('Đã gỡ tin nhắn khỏi buổi phát.')
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể gỡ tin nhắn.'))
  } finally {
    removingMessageId.value = null
  }
}

async function startLivestream() {
  if (!startForm.value.title.trim()) {
    toast.error('Vui lòng nhập tiêu đề buổi phát.')
    return
  }
  if (startForm.value.source === 'youtube' && !startForm.value.youtubeVideoId.trim()) {
    toast.error('Vui lòng dán liên kết hoặc ID video YouTube.')
    return
  }
  if (startForm.value.source === 'upload' && !startForm.value.storagePath.trim()) {
    toast.error('Vui lòng nhập mã luồng HLS do người vận hành cung cấp.')
    return
  }
  isStarting.value = true
  try {
    const res = await $fetch<{ ok: boolean; sessionId?: number }>('/api/admin/livestream/start', {
      method: 'POST',
      body: {
        title:          startForm.value.title.trim(),
        description:     startForm.value.description.trim() || undefined,
        source:         startForm.value.source,
        youtubeVideoId: startForm.value.source === 'youtube' ? startForm.value.youtubeVideoId.trim() : undefined,
        storagePath: startForm.value.source === 'upload' ? startForm.value.storagePath.trim() : undefined,
      },
    })
    if (res.ok && res.sessionId) {
      toast.success('Đã bắt đầu buổi phát trực tiếp.')
      startForm.value = { title: '', description: '', source: 'youtube', youtubeVideoId: '', storagePath: '' }
      await loadActive()
    }
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể bắt đầu buổi phát.'))
  } finally {
    isStarting.value = false
  }
}

async function stopLivestream() {
  if (!activeSession.value) return
  if (!confirm('Dừng buổi phát trực tiếp này?')) return
  isStopping.value = true
  try {
    const res = await $fetch<{ ok: boolean; sessionId?: number }>('/api/admin/livestream/stop', {
      method: 'POST',
      body: { sessionId: activeSession.value.id },
    })
    if (res.ok) {
      toast.success('Đã dừng buổi phát trực tiếp.')
      activeSession.value = null
      await loadActive()
    }
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể dừng buổi phát.'))
  } finally {
    isStopping.value = false
  }
}

function fmtTime(v: string | null): string {
  if (!v) return '—'
  return new Date(v).toLocaleString('vi-VN')
}

onMounted(() => { void loadActive() })
</script>

<template>
  <div class="flex flex-col gap-6 -mx-4 md:-mx-6 px-4 md:px-6 lg:px-8 max-w-none">
    <div class="flex items-start gap-3">
      <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#2c6e33] to-[#4A6741] text-white shadow-sm">
        <i class="fa-solid fa-tower-broadcast text-lg" aria-hidden="true"></i>
      </div>
      <div>
        <h1 class="text-[1.35rem] font-bold text-[#122815] leading-tight">Phát trực tiếp</h1>
        <p class="text-sm text-[#667768] mt-0.5">Bắt đầu, dừng và kiểm duyệt buổi phát trực tiếp.</p>
      </div>
    </div>

    <!-- Active session / loading / error -->
    <div class="bg-white rounded-xl border border-[#e2ece3] overflow-hidden shadow-sm">
      <!-- Loading -->
      <div v-if="loading" role="status" aria-busy="true" class="p-6">
        <span class="sr-only">Đang tải trạng thái buổi phát</span>
        <div class="flex flex-col gap-3 animate-pulse motion-reduce:animate-none">
          <div v-for="n in 4" :key="n" class="flex gap-3">
            <div v-for="c in 4" :key="c" class="h-10 bg-[#EEF2EC] rounded flex-1" aria-hidden="true"></div>
          </div>
        </div>
      </div>

      <!-- Error -->
      <div v-else-if="loadError" role="alert" class="px-6 py-12 text-center">
        <div class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-[#B04A4A]">
          <i class="fa-solid fa-triangle-exclamation text-xl" aria-hidden="true"></i>
        </div>
        <p class="text-[#B04A4A] text-sm mb-2">{{ loadError }}</p>
        <button type="button" class="inline-flex items-center gap-2 rounded-lg border border-[#e2ece3] px-4 py-2 text-sm font-semibold text-[#2c6e33] hover:bg-[#f8faf7] transition-colors" @click="loadActive()">
          <i class="fa-solid fa-rotate-right text-xs" aria-hidden="true"></i>Thử lại
        </button>
      </div>

      <!-- No active session -->
      <div v-else-if="!activeSession" class="p-8 md:p-12 text-center">
        <div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#f0f5f0] text-[#9bb89c]">
          <i class="fa-solid fa-tower-broadcast text-2xl" aria-hidden="true"></i>
        </div>
        <p class="text-[#667768] text-base font-medium mb-1">Không có buổi phát trực tiếp nào đang chạy</p>
        <p class="text-sm text-[#9bb89c] max-w-md mx-auto" v-if="canStart">Điền biểu mẫu bên dưới để bắt đầu một buổi phát mới.</p>
        <p class="text-sm text-[#9bb89c] max-w-md mx-auto" v-else>Liên hệ quản trị viên có quyền <span class="font-semibold">livestream/create</span> để bắt đầu.</p>
      </div>

      <!-- Active session -->
      <div v-else class="p-5 md:p-6">
        <div class="flex flex-wrap items-center gap-2 mb-4">
          <span class="inline-flex items-center gap-1.5 rounded-full bg-[#d12420] px-3 py-1.5 text-xs font-bold text-white shadow-sm">
            <span class="h-2 w-2 rounded-full bg-white animate-pulse motion-reduce:animate-none"></span>
            TRỰC TIẾP
          </span>
          <span class="inline-flex items-center gap-1.5 text-xs text-[#667768] bg-[#f8faf7] rounded-full px-3 py-1.5 border border-[#eef2ee]">
            <i class="fa-regular fa-clock text-[0.7rem]" aria-hidden="true"></i>{{ fmtTime(activeSession.startedAt) }}
          </span>
          <span v-if="activeSession.source === 'youtube'" class="inline-flex items-center gap-1.5 text-xs text-[#667768] bg-[#f8faf7] rounded-full px-3 py-1.5 border border-[#eef2ee]">
            <i class="fa-brands fa-youtube text-[0.85rem]" aria-hidden="true"></i>YouTube
          </span>
          <span v-else class="inline-flex items-center gap-1.5 text-xs text-[#667768] bg-[#f8faf7] rounded-full px-3 py-1.5 border border-[#eef2ee]">
            <i class="fa-solid fa-satellite-dish text-[0.8rem]" aria-hidden="true"></i>Luồng HLS cơ quan
          </span>
        </div>
        <h2 class="text-xl font-bold text-[#122815] mb-1.5 leading-snug">{{ activeSession.title }}</h2>
        <p v-if="activeSession.description" class="text-sm text-[#667768] whitespace-pre-line break-words mb-4 max-w-3xl">{{ activeSession.description }}</p>
        <!-- Video preview -->
        <div v-if="activeSession.embedUrl" class="rounded-xl overflow-hidden border border-[#e2ece3] bg-black mb-4 max-w-2xl">
          <iframe
            :src="activeSession.streamUrl"
            title="Xem trực tiếp"
            class="w-full aspect-video"
            frameborder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowfullscreen
          ></iframe>
        </div>
        <div class="flex flex-wrap gap-2.5">
          <a
            v-if="activeSession.embedUrl"
            :href="activeSession.embedUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-2 rounded-lg bg-[#2c6e33] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#245830] transition-colors shadow-sm"
          >
            <i class="fa-brands fa-youtube" aria-hidden="true"></i>
            Xem trên YouTube
          </a>
          <NuxtLink
            to="/media"
            class="inline-flex items-center gap-2 rounded-lg border border-[#e2ece3] bg-white px-4 py-2.5 text-sm font-semibold text-[#2c6e33] hover:bg-[#f8faf7] transition-colors"
          >
            <i class="fa-solid fa-eye" aria-hidden="true"></i>
            Trang công khai
          </NuxtLink>
          <button
            v-if="canStop"
            type="button"
            class="inline-flex items-center gap-2 rounded-lg bg-white border border-[#e8c2c2] px-4 py-2.5 text-sm font-semibold text-[#B04A4A] hover:bg-red-50 transition-colors disabled:opacity-50 shadow-sm"
            :disabled="isStopping"
            @click="stopLivestream()"
          >
            <i class="fa-solid fa-stop" aria-hidden="true"></i>
            {{ isStopping ? 'Đang dừng...' : 'Dừng buổi phát' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Start form -->
    <div v-if="canStart && !activeSession" class="bg-white rounded-xl border border-[#e2ece3] p-5 md:p-6 shadow-sm">
      <div class="flex items-center gap-2.5 mb-5">
        <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-[#e8f0e8] text-[#2c6e33]">
          <i class="fa-solid fa-plus text-sm" aria-hidden="true"></i>
        </div>
        <h2 class="text-lg font-bold text-[#122815]">Bắt đầu buổi phát trực tiếp</h2>
      </div>
      <div class="space-y-5">
        <!-- Tiêu đề -->
        <div>
          <label class="block text-sm font-medium text-[#1e251c] mb-1.5" for="ls-title">Tiêu đề <span class="text-[#d12420]">*</span></label>
          <input
            id="ls-title"
            v-model="startForm.title"
            type="text"
            maxlength="500"
            class="w-full rounded-lg border border-[#dde6de] px-3.5 py-2.5 text-sm text-[#1e251c] placeholder-[#9bb89c] outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/10 transition-shadow"
            placeholder="VD: Hội nghị tổng kết năm 2026"
          />
        </div>
        <!-- Mô tả -->
        <div>
          <label class="block text-sm font-medium text-[#1e251c] mb-1.5" for="ls-desc">Mô tả</label>
          <textarea
            id="ls-desc"
            v-model="startForm.description"
            rows="3"
            maxlength="5000"
            class="w-full rounded-lg border border-[#dde6de] px-3.5 py-2.5 text-sm text-[#1e251c] placeholder-[#9bb89c] outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/10 transition-shadow resize-y"
            placeholder="Giới thiệu ngắn về nội dung buổi phát..."
          />
        </div>
        <!-- Nguồn -->
        <div>
          <label class="block text-sm font-medium text-[#1e251c] mb-1.5" for="ls-source">Nguồn phát</label>
          <div class="relative">
            <select
              id="ls-source"
              v-model="startForm.source"
              class="w-full appearance-none rounded-lg border border-[#dde6de] bg-white px-3.5 py-2.5 pr-10 text-sm text-[#1e251c] outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/10 transition-shadow cursor-pointer"
            >
              <option value="youtube">YouTube — dán liên kết video</option>
              <option value="upload">Luồng HLS — mã từ bộ mã hóa cơ quan</option>
            </select>
            <i class="fa-solid fa-chevron-down pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-[#9bb89c]" aria-hidden="true"></i>
          </div>
        </div>
        <!-- YouTube source fields -->
        <div v-if="startForm.source === 'youtube'" class="rounded-xl border border-[#eef2ee] bg-[#fbfdfb] p-4 space-y-2">
          <label class="block text-sm font-medium text-[#1e251c] mb-0.5" for="ls-yt">Địa chỉ video YouTube <span class="text-[#d12420]">*</span></label>
          <div class="flex gap-2">
            <input
              id="ls-yt"
              v-model="startForm.youtubeVideoId"
              type="text"
              class="flex-1 rounded-lg border border-[#dde6de] px-3.5 py-2.5 text-sm text-[#1e251c] placeholder-[#9bb89c] outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/10 transition-shadow bg-white"
              placeholder="https://youtube.com/live/dQw4w9WgXcQ"
            />
            <button
              type="button"
              :disabled="fetchingMeta || !startForm.youtubeVideoId.trim()"
              class="shrink-0 rounded-lg bg-white border border-[#2c6e33] px-3.5 py-2.5 text-sm font-semibold text-[#2c6e33] hover:bg-[#e8f0e8] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 transition-colors"
              @click="fetchMeta"
            >
              <i :class="fetchingMeta ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-cloud-arrow-down'" class="text-xs" aria-hidden="true"></i>
              <span>{{ fetchingMeta ? 'Đang lấy…' : 'Lấy thông tin' }}</span>
            </button>
          </div>
          <p class="text-xs text-[#8aa08c]">Dán liên kết YouTube Live (hoặc video thường) — máy chủ tự bóc ID. Bấm "Lấy thông tin" để tự điền tiêu đề + xem ảnh thu nhỏ.</p>
          <p class="text-xs text-[#b8860b] bg-[#fffbe6] border border-[#f5e6a8] rounded-md px-2.5 py-1.5 inline-flex items-start gap-1.5">
            <i class="fa-solid fa-circle-info mt-0.5 shrink-0" aria-hidden="true"></i>
            <span>Hệ thống <strong>không phân biệt</strong> live và video thường qua URL. Dán link video thường sẽ vẫn hiện badge "Đang phát trực tiếp" — chỉ dùng link <strong>YouTube Live</strong> (đang phát thật) để tránh hiện sai trạng thái.</span>
          </p>
          <p v-if="metaError" role="alert" class="text-sm text-[#a32924]">
            <i class="fa-solid fa-circle-exclamation mr-1" aria-hidden="true"></i>{{ metaError }}
          </p>
          <!-- Preview metadata đã lấy -->
          <div v-if="previewThumb" class="flex gap-3 rounded-lg border border-[#e2ece3] bg-white p-3">
            <img
              :src="previewThumb"
              :alt="previewTitle"
              loading="lazy"
              class="w-32 aspect-video object-cover rounded-lg shrink-0"
            />
            <div class="flex flex-col gap-1 min-w-0">
              <span class="text-sm font-bold text-[#1e251c] line-clamp-2">{{ previewTitle }}</span>
              <span v-if="previewAuthor" class="text-xs text-[#667768]">
                <i class="fa-regular fa-circle-user mr-1" aria-hidden="true"></i>{{ previewAuthor }}
              </span>
              <span class="text-[0.72rem] text-[#2c6e33] font-semibold mt-auto inline-flex items-center gap-1">
                <i class="fa-solid fa-circle-check" aria-hidden="true"></i>Đã điền tiêu đề
              </span>
            </div>
          </div>
        </div>
        <!-- HLS source fields -->
        <div v-else class="rounded-xl border border-[#eef2ee] bg-[#fbfdfb] p-4 space-y-2">
          <label class="block text-sm font-medium text-[#1e251c] mb-0.5" for="ls-hls">Mã luồng HLS <span class="text-[#d12420]">*</span></label>
          <input
            id="ls-hls"
            v-model="startForm.storagePath"
            type="text"
            maxlength="1024"
            aria-describedby="ls-hls-help"
            class="w-full rounded-lg border border-[#dde6de] px-3.5 py-2.5 text-sm text-[#1e251c] placeholder-[#9bb89c] outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/10 transition-shadow bg-white"
            placeholder="VD: hoi-nghi-2026"
          />
          <p id="ls-hls-help" class="text-xs text-[#8aa08c]">
            <i class="fa-solid fa-circle-info mr-1 text-[0.7rem]" aria-hidden="true"></i>Nhập mã do người vận hành cung cấp sau khi bật bộ mã hóa. Hệ thống kiểm tra luồng trước khi bắt đầu.
          </p>
        </div>
        <!-- Submit -->
        <div class="pt-1">
          <button
            type="button"
            class="inline-flex items-center gap-2 rounded-lg bg-[#2c6e33] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#245830] transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            :disabled="isStarting || !startForm.title.trim()"
            @click="startLivestream()"
          >
            <i class="fa-solid fa-tower-broadcast" aria-hidden="true"></i>
            {{ isStarting ? 'Đang bắt đầu...' : 'Bắt đầu phát' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Current-session chat moderation -->
    <div v-if="activeSession" class="bg-white rounded-xl border border-[#e2ece3] p-5 md:p-6 shadow-sm">
      <div class="flex items-center justify-between gap-3 mb-4">
        <div class="flex items-center gap-2.5">
          <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-[#e8f0e8] text-[#2c6e33]">
            <i class="fa-solid fa-comments text-sm" aria-hidden="true"></i>
          </div>
          <div>
            <h2 class="text-lg font-bold text-[#122815] leading-tight">Kiểm duyệt chat</h2>
            <p class="text-xs text-[#667768] mt-0.5">Tin nhắn đang hiển thị cho người xem của buổi phát này.</p>
          </div>
        </div>
        <button
          type="button"
          class="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-[#e2ece3] bg-white px-3.5 py-2 text-sm font-semibold text-[#2c6e33] hover:bg-[#f8faf7] disabled:opacity-50 transition-colors"
          :disabled="chatLoading"
          @click="loadChatMessages(activeSession.id)"
        >
          <i :class="chatLoading ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-rotate-right'" class="text-xs" aria-hidden="true"></i>
          {{ chatLoading ? 'Đang tải...' : 'Làm mới' }}
        </button>
      </div>

      <div v-if="chatLoading" role="status" aria-busy="true" class="py-8 text-center">
        <i class="fa-solid fa-spinner fa-spin text-[#9bb89c] text-xl mb-2" aria-hidden="true"></i>
        <p class="text-sm text-[#667768]">Đang tải tin nhắn...</p>
      </div>
      <div v-else-if="chatError" role="alert" class="rounded-lg bg-red-50 border border-red-100 p-4 text-sm text-[#B04A4A]">
        <p class="flex items-center gap-2"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>{{ chatError }}</p>
        <button type="button" class="mt-2 font-semibold underline" @click="loadChatMessages(activeSession.id)">Thử lại</button>
      </div>
      <div v-else-if="chatMessages.length === 0" class="py-8 text-center">
        <i class="fa-regular fa-comments text-2xl text-[#c5d3c7] mb-2" aria-hidden="true"></i>
        <p class="text-sm text-[#667768]">Chưa có tin nhắn trong buổi phát này.</p>
      </div>
      <ol v-else class="space-y-2.5">
        <li v-for="message in chatMessages" :key="message.id" class="flex gap-3 rounded-lg border border-[#eef2ee] bg-[#fbfdfb] p-3">
          <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#e8f0e8] text-[#2c6e33] text-xs font-bold">
            {{ message.displayName.charAt(0).toUpperCase() }}
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold text-[#1e251c]">
              {{ message.displayName }}
              <time class="ml-2 font-normal text-[#9bb89c] text-xs" :datetime="message.createdAt">{{ fmtTime(message.createdAt) }}</time>
            </p>
            <p class="mt-1 whitespace-pre-wrap break-words text-sm text-[#526655]">{{ message.content }}</p>
          </div>
          <button
            v-if="canModerateChat"
            type="button"
            class="h-fit shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-[#e8c2c2] bg-white px-3 py-1.5 text-xs font-semibold text-[#B04A4A] hover:bg-red-50 disabled:opacity-50 transition-colors"
            :disabled="removingMessageId !== null"
            @click="removeChatMessage(message)"
          >
            <i class="fa-solid fa-trash-can text-[0.7rem]" aria-hidden="true"></i>
            {{ removingMessageId === message.id ? 'Đang gỡ...' : 'Gỡ' }}
          </button>
        </li>
      </ol>
    </div>
  </div>
</template>
