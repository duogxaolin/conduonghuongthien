<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

interface TranscriptMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  kind: string | null
  createdAt: string
}

interface RelatedSubmission {
  id: number
  fullName: string
  phone: string
  email: string | null
  formTitle: string | null
  createdAt: string | null
}

interface SessionDetail {
  id: string
  ip: string | null
  userAgent: string | null
  browser: string
  detectedPhone: string | null
  detectedName: string | null
  messageCount: number
  startedAt: string
  lastMessageAt: string
}

const route = useRoute()
const sessionId = computed(() => String(route.params.id ?? ''))

const session = ref<SessionDetail | null>(null)
const messages = ref<TranscriptMessage[]>([])
const relatedSubmissions = ref<RelatedSubmission[]>([])
const truncated = ref(false)
const loading = ref(true)
const loadError = ref('')

const fetchSession = async () => {
  loading.value = true
  loadError.value = ''
  try {
    const res = await $fetch<{
      ok: boolean
      session: SessionDetail
      messages: TranscriptMessage[]
      relatedSubmissions: RelatedSubmission[]
      truncated: boolean
    }>(`/api/admin/chatbot/sessions/${sessionId.value}`)
    if (res.ok) {
      session.value = res.session
      messages.value = res.messages
      relatedSubmissions.value = res.relatedSubmissions
      truncated.value = res.truncated
    }
  } catch (err: unknown) {
    loadError.value = errorMessage(err, 'Không thể tải nội dung phiên trò chuyện.')
  } finally {
    loading.value = false
  }
}

const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleString('vi-VN') : '—')
const fmtTime = (v: string) => new Date(v).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })

// Mirrors the labels the visitor's widget shows, so admin and visitor are
// looking at the same taxonomy rather than two vocabularies for one answer.
const KIND_LABELS: Record<string, string> = {
  knowledge: 'Kho kiến thức',
  small_talk: 'Trả lời thường nhật',
  provider: 'Trợ lý AI',
  not_found: 'Không tìm thấy câu trả lời',
  rate_limited: 'Vượt giới hạn tần suất',
  disabled: 'Trợ lý đang tắt',
  error: 'Lỗi hệ thống',
}
const kindLabel = (kind: string | null) => (kind ? (KIND_LABELS[kind] ?? kind) : '')
// Problem kinds read amber, normal answers read green: the two states a
// reviewer is actually scanning for.
const kindClass = (kind: string | null) =>
  kind && ['not_found', 'rate_limited', 'disabled', 'error'].includes(kind)
    ? 'bg-[#fff4e0] text-[#8a5a00]'
    : 'bg-[#eef6ef] text-[#2c6e33]'

onMounted(() => { fetchSession() })
</script>

<template>
  <div class="flex flex-col gap-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="m-0 text-[1.3rem] font-extrabold text-[#122815]">Nội dung phiên trò chuyện</h1>
        <p class="mt-1 mb-0 break-all text-[0.8rem] text-[#667768]">Mã phiên: {{ sessionId }}</p>
      </div>
      <nuxt-link
        to="/admin/chatbot/sessions"
        class="rounded-lg border border-[#c8d6c9] px-3.5 py-2 text-sm font-bold text-[#445546] hover:bg-[#f4f7f4]"
      >
        <i class="fa-solid fa-arrow-left mr-1 text-[0.75rem]" aria-hidden="true"></i> Danh sách phiên
      </nuxt-link>
    </div>

    <div v-if="loading" class="flex flex-col gap-5">
      <SkeletonForm label="Đang tải thông tin phiên" :fields="4" :has-action="false" />
      <SkeletonTable label="Đang tải nội dung trò chuyện" :rows="6" :cols="2" />
    </div>

    <div v-else-if="loadError" role="alert" class="rounded-xl border border-dashed border-[#e2a0a0] bg-white px-6 py-10 text-center text-[0.9rem] text-[#b04a4a]">
      <i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>
      {{ loadError }}
      <button type="button" class="ml-1 font-bold text-[#2c6e33] underline" @click="fetchSession()">Thử lại</button>
    </div>

    <template v-else-if="session">
      <!-- Metadata -->
      <div class="grid grid-cols-1 gap-4 rounded-xl border border-[#e2ece3] bg-white p-5 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p class="m-0 text-[0.75rem] font-bold uppercase tracking-wide text-[#667768]">Địa chỉ IP</p>
          <p class="m-0 mt-1 text-[0.95rem] font-bold text-[#122815]">{{ session.ip || 'Không ghi nhận' }}</p>
        </div>
        <div>
          <p class="m-0 text-[0.75rem] font-bold uppercase tracking-wide text-[#667768]">Trình duyệt</p>
          <p class="m-0 mt-1 text-[0.95rem] font-bold text-[#122815]">{{ session.browser }}</p>
          <p v-if="session.userAgent" class="m-0 mt-1 break-all text-[0.7rem] text-[#98a599]">{{ session.userAgent }}</p>
        </div>
        <div>
          <p class="m-0 text-[0.75rem] font-bold uppercase tracking-wide text-[#667768]">Bắt đầu</p>
          <p class="m-0 mt-1 text-[0.95rem] font-bold text-[#122815]">{{ fmtDate(session.startedAt) }}</p>
          <p class="m-0 mt-1 text-[0.7rem] text-[#98a599]">Tin nhắn cuối: {{ fmtDate(session.lastMessageAt) }}</p>
        </div>
        <div>
          <p class="m-0 text-[0.75rem] font-bold uppercase tracking-wide text-[#667768]">Số tin nhắn</p>
          <p class="m-0 mt-1 text-[0.95rem] font-bold text-[#122815]">{{ session.messageCount }}</p>
        </div>
      </div>

      <!-- Detected contact + cross-link to submissions -->
      <div
        v-if="session.detectedPhone || session.detectedName"
        class="rounded-xl border border-[#cfe4d1] bg-[#f4faf5] p-5"
      >
        <p class="m-0 text-[0.8rem] font-bold uppercase tracking-wide text-[#2c6e33]">
          <i class="fa-solid fa-id-card mr-1" aria-hidden="true"></i> Thông tin khách đã nêu trong trò chuyện
        </p>
        <div class="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-[0.92rem] text-[#1d4a22]">
          <span v-if="session.detectedName"><strong>Họ tên:</strong> {{ session.detectedName }}</span>
          <span v-if="session.detectedPhone"><strong>Số điện thoại:</strong> {{ session.detectedPhone }}</span>
        </div>

        <div v-if="relatedSubmissions.length" class="mt-4 border-t border-[#cfe4d1] pt-3">
          <p class="m-0 text-[0.82rem] font-bold text-[#1d4a22]">
            Khách này đã gửi {{ relatedSubmissions.length }} đơn đăng ký trước đó:
          </p>
          <ul class="mt-2 flex flex-col gap-1.5">
            <li v-for="sub in relatedSubmissions" :key="sub.id" class="text-[0.85rem] text-[#2c3e2e]">
              <nuxt-link to="/admin/submissions" class="font-bold text-[#2c6e33] hover:underline">#{{ sub.id }} {{ sub.fullName }}</nuxt-link>
              · {{ sub.phone }}
              <span v-if="sub.formTitle"> · {{ sub.formTitle }}</span>
              <span class="text-[#667768]"> · {{ fmtDate(sub.createdAt) }}</span>
            </li>
          </ul>
        </div>
        <p v-else-if="session.detectedPhone" class="m-0 mt-3 border-t border-[#cfe4d1] pt-3 text-[0.82rem] text-[#5a6b5b]">
          Chưa tìm thấy đơn đăng ký nào trùng số điện thoại này.
        </p>
      </div>

      <!-- Transcript -->
      <div class="overflow-hidden rounded-xl border border-[#e2ece3] bg-white">
        <div class="border-b border-[#e2ece3] bg-[#f8faf8] px-5 py-3">
          <h2 class="m-0 text-[0.95rem] font-extrabold text-[#122815]">Nội dung trò chuyện</h2>
        </div>

        <div v-if="messages.length === 0" class="px-5 py-10 text-center text-[0.9rem] text-[#667768]">
          Phiên này chưa lưu được tin nhắn nào.
        </div>

        <div v-else class="flex flex-col gap-4 p-5">
          <div
            v-for="msg in messages"
            :key="msg.id"
            class="flex flex-col gap-1"
            :class="msg.role === 'user' ? 'items-end' : 'items-start'"
          >
            <span class="text-[0.72rem] font-bold uppercase tracking-wide text-[#667768]">
              {{ msg.role === 'user' ? 'Khách' : 'Trợ lý' }} · {{ fmtTime(msg.createdAt) }}
            </span>
            <div
              class="max-w-[85%] whitespace-pre-wrap rounded-xl px-4 py-2.5 text-[0.9rem] leading-relaxed"
              :class="msg.role === 'user'
                ? 'bg-[#2c6e33] text-white'
                : 'border border-[#e2ece3] bg-[#f8faf8] text-[#1f2f21]'"
            >{{ msg.content }}</div>
            <span
              v-if="msg.role === 'assistant' && msg.kind"
              class="rounded-full px-2 py-0.5 text-[0.7rem] font-bold"
              :class="kindClass(msg.kind)"
            >{{ kindLabel(msg.kind) }}</span>
          </div>

          <p v-if="truncated" class="m-0 border-t border-[#eef2ee] pt-3 text-center text-[0.8rem] text-[#8a5a00]">
            <i class="fa-solid fa-circle-info mr-1" aria-hidden="true"></i>
            Phiên này dài hơn giới hạn hiển thị — chỉ hiện 500 tin nhắn đầu tiên.
          </p>
        </div>
      </div>
    </template>
  </div>
</template>
