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
    toast.error('Vui lòng nhập ID video YouTube.')
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
  <div class="p-4 md:p-6 lg:p-8 space-y-6">
    <div>
      <h1 class="text-2xl font-bold text-[#2c3e2e]">Livestream</h1>
      <p class="text-sm text-[#6b7d6c] mt-1">Bắt đầu, dừng và kiểm duyệt buổi phát trực tiếp.</p>
    </div>

    <!-- Active session / loading / error -->
    <div class="bg-white rounded-xl border border-[#e2ece3] overflow-hidden">
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
      <div v-else-if="loadError" role="alert" class="px-6 py-10 text-center text-[#B04A4A] text-[0.95rem]">
        <i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>
        {{ loadError }} Vui lòng <button type="button" class="text-[#4A6741] font-bold underline" @click="loadActive()">thử lại</button>.
      </div>

      <!-- No active session -->
      <div v-else-if="!activeSession" class="p-6 text-center">
        <i class="fa-solid fa-tower-broadcast text-3xl mb-3 text-[#c5d3c7]" aria-hidden="true"></i>
        <p class="text-[#6b7d6c] text-[0.95rem]">Không có buổi phát trực tiếp nào đang chạy.</p>
      </div>

      <!-- Active session -->
      <div v-else class="p-6">
        <div class="flex items-center gap-2 mb-4">
          <span class="inline-flex items-center gap-1.5 rounded-full bg-[#d12420] px-2.5 py-1 text-xs font-bold text-white">
            <span class="h-2 w-2 rounded-full bg-white animate-pulse motion-reduce:animate-none"></span>
            TRỰC TIẾP
          </span>
          <span class="text-sm text-[#8aa08c]">Bắt đầu: {{ fmtTime(activeSession.startedAt) }}</span>
        </div>
        <h2 class="text-lg font-bold text-[#2c3e2e] mb-1">{{ activeSession.title }}</h2>
        <p v-if="activeSession.description" class="text-sm text-[#6b7d6c] whitespace-pre-line break-words mb-3">{{ activeSession.description }}</p>
        <div class="flex flex-wrap gap-2 mt-4">
          <a
            v-if="activeSession.embedUrl"
            :href="activeSession.embedUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-2 rounded-lg bg-[#4A6741] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3d5636] transition-colors"
          >
            <i class="fa-solid fa-youtube" aria-hidden="true"></i>
            Xem trên YouTube
          </a>
          <NuxtLink
            to="/media"
            class="inline-flex items-center gap-2 rounded-lg border border-[#dde6de] px-4 py-2 text-sm font-semibold text-[#4A6741] hover:bg-[#e6f4ea] transition-colors"
          >
            <i class="fa-solid fa-eye" aria-hidden="true"></i>
            Trang công khai
          </NuxtLink>
          <button
            v-if="canStop"
            type="button"
            class="inline-flex items-center gap-2 rounded-lg bg-[#d12420] px-4 py-2 text-sm font-semibold text-white hover:bg-[#b01f1b] transition-colors disabled:opacity-50"
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
    <div v-if="canStart && !activeSession" class="bg-white rounded-xl border border-[#e2ece3] p-6">
      <h2 class="text-lg font-bold text-[#2c3e2e] mb-4">Bắt đầu buổi phát trực tiếp</h2>
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-[#2c3e2e] mb-1" for="ls-title">Tiêu đề <span class="text-[#d12420]">*</span></label>
          <input
            id="ls-title"
            v-model="startForm.title"
            type="text"
            maxlength="500"
            class="w-full rounded-lg border border-[#dde6de] px-3 py-2 text-sm outline-none focus:border-[#4A6741]"
            placeholder="Tiêu đề buổi phát..."
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-[#2c3e2e] mb-1" for="ls-desc">Mô tả</label>
          <textarea
            id="ls-desc"
            v-model="startForm.description"
            rows="3"
            maxlength="5000"
            class="w-full rounded-lg border border-[#dde6de] px-3 py-2 text-sm outline-none focus:border-[#4A6741] resize-y"
            placeholder="Mô tả buổi phát..."
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-[#2c3e2e] mb-1" for="ls-source">Nguồn</label>
          <select
            id="ls-source"
            v-model="startForm.source"
            class="w-full rounded-lg border border-[#dde6de] px-3 py-2 text-sm outline-none focus:border-[#4A6741]"
          >
            <option value="youtube">YouTube</option>
            <option value="upload">Luồng HLS của cơ quan</option>
          </select>
        </div>
        <div v-if="startForm.source === 'youtube'">
          <label class="block text-sm font-medium text-[#2c3e2e] mb-1" for="ls-yt">ID video YouTube <span class="text-[#d12420]">*</span></label>
          <input
            id="ls-yt"
            v-model="startForm.youtubeVideoId"
            type="text"
            class="w-full rounded-lg border border-[#dde6de] px-3 py-2 text-sm outline-none focus:border-[#4A6741]"
            placeholder="VD: dQw4w9WgXcQ"
          />
          <p class="text-xs text-[#8aa08c] mt-1">Dán ID video (11 ký tự) hoặc URL đầy đủ — server tự bóc ID.</p>
        </div>
        <div v-else>
          <label class="block text-sm font-medium text-[#2c3e2e] mb-1" for="ls-hls">Mã luồng HLS <span class="text-[#d12420]">*</span></label>
          <input
            id="ls-hls"
            v-model="startForm.storagePath"
            type="text"
            maxlength="1024"
            aria-describedby="ls-hls-help"
            class="w-full rounded-lg border border-[#dde6de] px-3 py-2 text-sm outline-none focus:border-[#4A6741]"
            placeholder="VD: hoi-nghi-2026"
          />
          <p id="ls-hls-help" class="text-xs text-[#8aa08c] mt-1">Nhập mã do người vận hành cung cấp sau khi bật bộ mã hóa. Hệ thống kiểm tra luồng trước khi bắt đầu.</p>
        </div>
        <button
          type="button"
          class="inline-flex items-center gap-2 rounded-lg bg-[#2c6e33] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#245830] transition-colors disabled:opacity-50"
          :disabled="isStarting || !startForm.title.trim()"
          @click="startLivestream()"
        >
          <i class="fa-solid fa-tower-broadcast" aria-hidden="true"></i>
          {{ isStarting ? 'Đang bắt đầu...' : 'Bắt đầu phát' }}
        </button>
      </div>
    </div>

    <!-- Current-session chat moderation -->
    <div v-if="activeSession" class="bg-white rounded-xl border border-[#e2ece3] p-6">
      <div class="flex items-center justify-between gap-3 mb-4">
        <div>
          <h2 class="text-lg font-bold text-[#2c3e2e]">Kiểm duyệt chat</h2>
          <p class="text-sm text-[#6b7d6c] mt-1">Tin nhắn đang hiển thị cho người xem của buổi phát này.</p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-lg border border-[#dde6de] px-3 py-2 text-sm font-semibold text-[#4A6741] hover:bg-[#e6f4ea] disabled:opacity-50"
          :disabled="chatLoading"
          @click="loadChatMessages(activeSession.id)"
        >
          {{ chatLoading ? 'Đang tải...' : 'Làm mới' }}
        </button>
      </div>

      <p v-if="chatLoading" role="status" class="text-sm text-[#6b7d6c]">Đang tải tin nhắn...</p>
      <div v-else-if="chatError" role="alert" class="text-sm text-[#B04A4A]">
        {{ chatError }}
        <button type="button" class="font-semibold underline" @click="loadChatMessages(activeSession.id)">Thử lại</button>
      </div>
      <p v-else-if="chatMessages.length === 0" class="text-sm text-[#6b7d6c]">Chưa có tin nhắn trong buổi phát này.</p>
      <ol v-else class="divide-y divide-[#edf2ed]">
        <li v-for="message in chatMessages" :key="message.id" class="flex gap-3 py-3">
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold text-[#2c3e2e]">
              {{ message.displayName }}
              <time class="ml-2 font-normal text-[#8aa08c]" :datetime="message.createdAt">{{ fmtTime(message.createdAt) }}</time>
            </p>
            <p class="mt-1 whitespace-pre-wrap break-words text-sm text-[#526655]">{{ message.content }}</p>
          </div>
          <button
            v-if="canModerateChat"
            type="button"
            class="h-fit shrink-0 rounded-lg border border-[#e6c2c2] px-3 py-1.5 text-sm font-semibold text-[#B04A4A] hover:bg-[#fff4f4] disabled:opacity-50"
            :disabled="removingMessageId !== null"
            @click="removeChatMessage(message)"
          >
            {{ removingMessageId === message.id ? 'Đang gỡ...' : 'Gỡ' }}
          </button>
        </li>
      </ol>
    </div>
  </div>
</template>
