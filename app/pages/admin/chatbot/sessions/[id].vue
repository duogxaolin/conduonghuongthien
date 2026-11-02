<script setup lang="ts">
import type { AdminChatSessionDeleteResponse, AdminChatSessionResponse } from '~/types/admin-chatbot-api'
definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

// Derived from the handler (wave3 7.1 batch F) — they replace three hand-written interfaces.
type TranscriptMessage = AdminChatSessionResponse['messages'][number]
type RelatedSubmission = AdminChatSessionResponse['relatedSubmissions'][number]
type SessionDetail = AdminChatSessionResponse['session']

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
    const res = await adminFetch<AdminChatSessionResponse>(`/api/admin/chatbot/sessions/${sessionId.value}`)
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
    : 'bg-[#eef6ef] text-brand-700'

// ─── Xoá phiên này (yêu cầu của người dân) ───────────────────────────────────
// The route checks `chatbot_knowledge.delete`; without it the button is not shown.
const router = useRouter()
const toast = useToast()
const { confirm } = useConfirm()
const { hasPermission } = useAdminAuth()
const canDelete = computed(() => hasPermission('chatbot_knowledge', 'delete'))
const deleting = ref(false)
const SESSIONS_LIST = '/admin/chatbot/sessions'

async function deleteSession() {
  if (!canDelete.value || !session.value || deleting.value) return
  // What the route removes, and what it leaves (verifier W2): the review-queue rows of
  // flagged turns (`session_id`, no FK), forms matching the phone number, audit rows.
  // The forms already listed on this page are named by count.
  const forms = relatedSubmissions.value.length
    ? `${relatedSubmissions.value.length} đơn đăng ký khách này đã gửi (xóa riêng ở mục Đơn đăng ký)`
    : 'đơn đăng ký khách đã gửi'
  if (!await confirm({
    title: 'Xóa phiên trò chuyện',
    message: `Xóa vĩnh viễn phiên trò chuyện này cùng ${session.value.messageCount} tin nhắn? Tin nhắn và thông tin liên hệ (họ tên, số điện thoại) ghi trong phiên sẽ bị xóa, không thể hoàn tác. Không bị xóa theo: ${forms}, hàng chờ kiểm duyệt của tin nhắn bị gắn cờ, nhật ký thao tác.`,
    confirmLabel: 'Xóa vĩnh viễn',
    danger: true,
  })) return

  deleting.value = true
  try {
    await adminFetch<AdminChatSessionDeleteResponse>(`/api/admin/chatbot/sessions/${encodeURIComponent(sessionId.value)}`, { method: 'DELETE' })
    toast.success('Đã xóa phiên trò chuyện.')
    await router.push(SESSIONS_LIST)
  } catch (err: unknown) {
    // 404: another officer or the retention purge removed it since this page loaded
    // — the outcome asked for, and nothing is left here to look at. The route's own
    // 404 sentence is English ("Chat session not found"), so the page says it.
    if (errorStatus(err) === 404) {
      toast.warning('Phiên trò chuyện này không còn tồn tại (có thể đã bị xóa trước đó).')
      await router.push(SESSIONS_LIST)
      return
    }
    toast.error(errorMessage(err, 'Không thể xóa phiên trò chuyện.'))
  } finally {
    deleting.value = false
  }
}

onMounted(() => { fetchSession() })
</script>

<template>
  <div class="flex flex-col gap-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="m-0 text-[1.3rem] font-extrabold text-brand-950">Nội dung phiên trò chuyện</h1>
        <p class="mt-1 mb-0 break-all text-[0.8rem] text-ink-muted">Mã phiên: {{ sessionId }}</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <nuxt-link
          to="/admin/chatbot/sessions"
          class="rounded-lg border border-line-strong px-3.5 py-2 text-sm font-bold text-[#445546] hover:bg-surface"
        >
          <i class="fa-solid fa-arrow-left mr-1 text-[0.75rem]" aria-hidden="true"></i> Danh sách phiên
        </nuxt-link>
        <button
          v-if="canDelete && session"
          type="button"
          class="rounded-lg border border-danger-soft bg-white px-3.5 py-2 text-sm font-bold text-danger-soft hover:bg-danger-bg focus:outline-none focus:ring-2 focus:ring-brand-700 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          :disabled="deleting"
          @click="deleteSession()"
        >
          <i class="fa-solid fa-trash-can mr-1 text-[0.75rem]" aria-hidden="true"></i>
          {{ deleting ? 'Đang xóa…' : 'Xóa phiên này' }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="flex flex-col gap-5">
      <SkeletonForm label="Đang tải thông tin phiên" :fields="4" :has-action="false" />
      <SkeletonTable label="Đang tải nội dung trò chuyện" :rows="6" :cols="2" />
    </div>

    <div v-else-if="loadError" role="alert" class="rounded-xl border border-dashed border-[#e2a0a0] bg-white px-6 py-10 text-center text-[0.9rem] text-danger-soft">
      <i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>
      {{ loadError }}
      <button type="button" class="ml-1 font-bold text-brand-700 underline" @click="fetchSession()">Thử lại</button>
    </div>

    <template v-else-if="session">
      <!-- Metadata -->
      <div class="grid grid-cols-1 gap-4 rounded-xl border border-line bg-white p-5 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p class="m-0 text-[0.75rem] font-bold uppercase tracking-wide text-ink-muted">Địa chỉ IP</p>
          <p class="m-0 mt-1 text-[0.95rem] font-bold text-brand-950">{{ session.ip || 'Không ghi nhận' }}</p>
        </div>
        <div>
          <p class="m-0 text-[0.75rem] font-bold uppercase tracking-wide text-ink-muted">Trình duyệt</p>
          <p class="m-0 mt-1 text-[0.95rem] font-bold text-brand-950">{{ session.browser }}</p>
          <p v-if="session.userAgent" class="m-0 mt-1 break-all text-[0.7rem] text-[#98a599]">{{ session.userAgent }}</p>
        </div>
        <div>
          <p class="m-0 text-[0.75rem] font-bold uppercase tracking-wide text-ink-muted">Bắt đầu</p>
          <p class="m-0 mt-1 text-[0.95rem] font-bold text-brand-950">{{ fmtDate(session.startedAt) }}</p>
          <p class="m-0 mt-1 text-[0.7rem] text-[#98a599]">Tin nhắn cuối: {{ fmtDate(session.lastMessageAt) }}</p>
        </div>
        <div>
          <p class="m-0 text-[0.75rem] font-bold uppercase tracking-wide text-ink-muted">Số tin nhắn</p>
          <p class="m-0 mt-1 text-[0.95rem] font-bold text-brand-950">{{ session.messageCount }}</p>
        </div>
      </div>

      <!-- Detected contact + cross-link to submissions -->
      <div
        v-if="session.detectedPhone || session.detectedName"
        class="rounded-xl border border-[#cfe4d1] bg-surface-tint p-5"
      >
        <p class="m-0 text-[0.8rem] font-bold uppercase tracking-wide text-brand-700">
          <i class="fa-solid fa-id-card mr-1" aria-hidden="true"></i> Thông tin khách đã nêu trong trò chuyện
        </p>
        <div class="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-[0.92rem] text-brand-900">
          <span v-if="session.detectedName"><strong>Họ tên:</strong> {{ session.detectedName }}</span>
          <span v-if="session.detectedPhone"><strong>Số điện thoại:</strong> {{ session.detectedPhone }}</span>
        </div>

        <div v-if="relatedSubmissions.length" class="mt-4 border-t border-[#cfe4d1] pt-3">
          <p class="m-0 text-[0.82rem] font-bold text-brand-900">
            Khách này đã gửi {{ relatedSubmissions.length }} đơn đăng ký trước đó<span v-if="canDelete"> (xóa phiên trò chuyện không xóa các đơn này)</span>:
          </p>
          <ul class="mt-2 flex flex-col gap-1.5">
            <li v-for="sub in relatedSubmissions" :key="sub.id" class="text-[0.85rem] text-ink-admin">
              <nuxt-link to="/admin/submissions" class="font-bold text-brand-700 hover:underline">#{{ sub.id }} {{ sub.fullName }}</nuxt-link>
              · {{ sub.phone }}
              <span v-if="sub.formTitle"> · {{ sub.formTitle }}</span>
              <span class="text-ink-muted"> · {{ fmtDate(sub.createdAt) }}</span>
            </li>
          </ul>
        </div>
        <p v-else-if="session.detectedPhone" class="m-0 mt-3 border-t border-[#cfe4d1] pt-3 text-[0.82rem] text-ink-soft">
          Chưa tìm thấy đơn đăng ký nào trùng số điện thoại này.
        </p>
      </div>

      <!-- Transcript -->
      <div class="overflow-hidden rounded-xl border border-line bg-white">
        <div class="border-b border-line bg-surface px-5 py-3">
          <h2 class="m-0 text-[0.95rem] font-extrabold text-brand-950">Nội dung trò chuyện</h2>
        </div>

        <div v-if="messages.length === 0" class="px-5 py-10 text-center text-[0.9rem] text-ink-muted">
          Phiên này chưa lưu được tin nhắn nào.
        </div>

        <div v-else class="flex flex-col gap-4 p-5">
          <div
            v-for="msg in messages"
            :key="msg.id"
            class="flex flex-col gap-1"
            :class="msg.role === 'user' ? 'items-end' : 'items-start'"
          >
            <span class="text-[0.72rem] font-bold uppercase tracking-wide text-ink-muted">
              {{ msg.role === 'user' ? 'Khách' : 'Trợ lý' }} · {{ fmtTime(msg.createdAt) }}
            </span>
            <div
              class="max-w-[85%] whitespace-pre-wrap rounded-xl px-4 py-2.5 text-[0.9rem] leading-relaxed"
              :class="msg.role === 'user'
                ? 'bg-brand-700 text-white'
                : 'border border-line bg-surface text-[#1f2f21]'"
            >{{ msg.content }}</div>
            <span
              v-if="msg.role === 'assistant' && msg.kind"
              class="rounded-full px-2 py-0.5 text-[0.7rem] font-bold"
              :class="kindClass(msg.kind)"
            >{{ kindLabel(msg.kind) }}</span>
          </div>

          <p v-if="truncated" class="m-0 border-t border-surface-tint pt-3 text-center text-[0.8rem] text-[#8a5a00]">
            <i class="fa-solid fa-circle-info mr-1" aria-hidden="true"></i>
            Phiên này dài hơn giới hạn hiển thị — chỉ hiện 500 tin nhắn đầu tiên.
          </p>
        </div>
      </div>
    </template>
  </div>
</template>
