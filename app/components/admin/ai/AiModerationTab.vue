<script setup lang="ts">
/**
 * Moderation tab của AI Panel — Sổ đối soát nội dung bị ẩn + Quy tắc kiểm duyệt
 * an ninh. Tách khỏi `ai/index.vue` theo pattern tab độc lập.
 *
 * Self-contained: fetch rules + queue, add/toggle/delete rule, resolve queue item
 * (approve / reject_delete / ban_ip). Phụ thuộc duy nhất: `toast`/`confirm` qua
 * Nuxt auto-import (module-scoped, gọi trực tiếp trong con). Không emit, không
 * prop — tab tự scope.
 *
 * NOTE — ngoại lệ quy tắc "file ~400 dòng phải tách": file 585 dòng, trong đó
 * ~425 dòng là template duplicate cố ý (desktop table + mobile card cho cùng 1
 * dataset — queue + rules). Script logic chỉ ~160 dòng. Tách 4 block ra sub-component
 * sẽ sinh boilerplate props/emit nhiều hơn lợi (resolveQueueItem/toggleModerationRule/
 * deleteModerationRule cần truyền item/rule + emit event trở về). Giữ nguyên có chủ đích.
 */
import { errorMessage } from '~/utils/errorMessage'
import { RULE_CATEGORY_LABELS, formatTime } from '~/utils/ai-service-labels'

interface ModerationRule {
  id: number
  category: string
  ruleType: string
  pattern: string
  action: string
  severity: string
  isEnabled: boolean
  createdAt: string
}

interface ModerationQueueItem {
  id: number
  targetType: string
  targetId: number | null
  authorName: string | null
  authorIp: string | null
  contentSnippet: string
  flaggedReason: string
  matchedRules: string[] | null
  severity: string
  status: string
  contextTitle?: string | null
  contextUrl?: string | null
  sessionId?: string | null
  isIpBanned?: boolean
  createdAt: string
}

const toast = useToast()
const { confirm } = useConfirm()

const moderationSubTab = ref<'queue' | 'rules'>('queue')
const moderationLoading = ref(false)
const moderationError = ref('')
const moderationRules = ref<ModerationRule[]>([])
const moderationQueue = ref<ModerationQueueItem[]>([])
const queueStatusFilter = ref('pending')

const newRuleForm = reactive({
  category: 'hostile_forces',
  ruleType: 'keyword',
  pattern: '',
  action: 'auto_hide',
  severity: 'critical',
})

async function loadModeration() {
  moderationLoading.value = true
  moderationError.value = ''
  try {
    const [rulesData, queueData] = await Promise.all([
      ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; rules: ModerationRule[] }>)('/api/admin/ai/moderation/rules'),
      ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; items: ModerationQueueItem[] }>)('/api/admin/ai/moderation/queue', {
        params: { status: queueStatusFilter.value },
      }),
    ])
    moderationRules.value = rulesData.rules
    moderationQueue.value = queueData.items
  } catch (err: unknown) {
    moderationError.value = errorMessage(err, 'Không thể tải dữ liệu kiểm duyệt an ninh.')
  } finally {
    moderationLoading.value = false
  }
}

async function addModerationRule() {
  if (!newRuleForm.pattern.trim()) {
    toast.warning('Vui lòng nhập từ khóa hoặc mẫu nhận diện.')
    return
  }
  try {
    await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)('/api/admin/ai/moderation/rules', {
      method: 'POST',
      body: newRuleForm,
    })
    toast.success('Đã thêm quy tắc kiểm duyệt an ninh mới!')
    newRuleForm.pattern = ''
    await loadModeration()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể thêm quy tắc.'))
  }
}

async function toggleModerationRule(rule: ModerationRule) {
  try {
    await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)(`/api/admin/ai/moderation/rules/${rule.id}`, {
      method: 'PUT',
      body: { isEnabled: !rule.isEnabled },
    })
    rule.isEnabled = !rule.isEnabled
    toast.success(`Đã ${rule.isEnabled ? 'bật' : 'tắt'} quy tắc.`)
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể cập nhật quy tắc.'))
  }
}

async function deleteModerationRule(rule: ModerationRule) {
  const ok = await confirm({
    title: 'Xóa quy tắc kiểm duyệt',
    message: `Bạn có chắc muốn xóa quy tắc "${rule.pattern}"?`,
    confirmText: 'Xóa',
    tone: 'danger',
  })
  if (!ok) return
  try {
    await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)(`/api/admin/ai/moderation/rules/${rule.id}`, { method: 'DELETE' })
    toast.success('Đã xóa quy tắc.')
    await loadModeration()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể xóa quy tắc.'))
  }
}

async function resolveQueueItem(item: ModerationQueueItem, action: 'approve' | 'reject_delete' | 'ban_ip') {
  let confirmMsg = 'Bạn có chắc chắn thực hiện thao tác này?'
  if (action === 'approve') confirmMsg = 'Xác nhận nội dung này an toàn và hiển thị công khai lại?'
  else if (action === 'reject_delete') confirmMsg = 'Xác nhận nội dung vi phạm và xóa vĩnh viễn?'
  else if (action === 'ban_ip') confirmMsg = `Xác nhận xóa nội dung và CẤM vĩnh viễn địa chỉ IP ${item.authorIp}?`

  const ok = await confirm({
    title: 'Xử lý đối soát an ninh',
    message: confirmMsg,
    confirmText: action === 'approve' ? 'Duyệt an toàn' : action === 'ban_ip' ? 'Cấm IP' : 'Xóa vĩnh viễn',
    tone: action === 'approve' ? 'primary' : 'danger',
  })
  if (!ok) return

  try {
    await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)(`/api/admin/ai/moderation/queue/${item.id}/resolve`, {
      method: 'POST',
      body: { action },
    })
    toast.success('Đã xử lý đối soát thành công!')
    await loadModeration()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể xử lý đối soát.'))
  }
}

// Tự fetch khi mount — không phụ thuộc watch(activeTab) ở cha (ref assign sau patch).
onMounted(() => { void loadModeration() })

// Cha gọi khi tab được lazy-load.
defineExpose<{ loadModeration: typeof loadModeration }>({ loadModeration })
</script>

<template>
  <div class="flex flex-col gap-5">
    <div v-if="moderationError" class="rounded-lg border border-[#f1b8b5] bg-[#fff4f3] p-3 text-sm text-[#a32924] flex flex-col sm:flex-row sm:items-center gap-2" role="alert">
      <span><strong>Lỗi:</strong> {{ moderationError }}</span>
      <button type="button" class="font-bold underline text-[#4A6741] cursor-pointer sm:ml-auto" @click="loadModeration()">Thử lại</button>
    </div>

    <!-- Moderation Sub-tabs -->
    <div class="flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-3 bg-white p-3.5 rounded-xl border border-[#e2ece3]">
      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 border"
          :class="moderationSubTab === 'queue' ? 'bg-[#1e4620] text-white border-[#1e4620] shadow-xs' : 'bg-white text-[#667768] border-[#c8d6c9] hover:bg-[#f0f7f1]'"
          @click="moderationSubTab = 'queue'"
        >
          <i class="fa-solid fa-inbox" aria-hidden="true"></i>
          <span>Sổ đối soát nội dung bị ẩn</span>
          <span v-if="moderationQueue.filter(q => q.status === 'pending').length" class="px-1.5 py-0.2 rounded-full bg-red-500 text-white text-[0.65rem]">
            {{ moderationQueue.filter(q => q.status === 'pending').length }}
          </span>
        </button>
        <button
          type="button"
          class="px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 border"
          :class="moderationSubTab === 'rules' ? 'bg-[#1e4620] text-white border-[#1e4620] shadow-xs' : 'bg-white text-[#667768] border-[#c8d6c9] hover:bg-[#f0f7f1]'"
          @click="moderationSubTab = 'rules'"
        >
          <i class="fa-solid fa-list-check" aria-hidden="true"></i>
          <span>Quy tắc kiểm duyệt an ninh ({{ moderationRules.length }})</span>
        </button>
      </div>

      <button
        type="button"
        class="px-3 py-1.5 rounded-lg border border-[#c8d6c9] bg-white text-xs font-semibold text-[#1e4620] hover:bg-[#f0f7f1] transition-colors cursor-pointer flex items-center gap-1.5"
        :disabled="moderationLoading"
        @click="loadModeration()"
      >
        <i class="fa-solid fa-rotate text-xs" :class="moderationLoading ? 'animate-spin' : ''" aria-hidden="true"></i>
        <span>Làm mới</span>
      </button>
    </div>

    <div v-if="moderationLoading" class="flex items-center justify-center py-12" role="status" aria-busy="true">
      <span class="sr-only">Đang tải dữ liệu kiểm duyệt</span>
      <div class="flex gap-1.5" aria-hidden="true">
        <span class="w-2.5 h-2.5 rounded-full bg-[#2c6e33] animate-pulse motion-reduce:animate-none"></span>
        <span class="w-2.5 h-2.5 rounded-full bg-[#2c6e33] animate-pulse motion-reduce:animate-none" style="animation-delay: 0.15s"></span>
        <span class="w-2.5 h-2.5 rounded-full bg-[#2c6e33] animate-pulse motion-reduce:animate-none" style="animation-delay: 0.3s"></span>
      </div>
    </div>

    <template v-else-if="!moderationError">
      <!-- ── SUBTAB 1: REVIEW QUEUE ── -->
      <div v-if="moderationSubTab === 'queue'" class="flex flex-col gap-4">
        <!-- Queue Status Filters -->
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-xs font-bold text-[#667768] w-full sm:w-auto">Lọc trạng thái:</span>
          <button
            v-for="s in [{ key: 'pending', label: 'Chờ đối soát' }, { key: 'approved', label: 'Đã duyệt an toàn' }, { key: 'rejected', label: 'Đã xóa' }, { key: 'banned', label: 'Đã cấm IP' }, { key: 'all', label: 'Tất cả' }]"
            :key="s.key"
            type="button"
            class="px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer border"
            :class="queueStatusFilter === s.key ? 'bg-[#2c6e33] text-white border-[#2c6e33]' : 'bg-white text-[#667768] border-[#d0ddd1] hover:bg-[#f0f7f1]'"
            @click="queueStatusFilter = s.key; loadModeration()"
          >
            {{ s.label }}
          </button>
        </div>

        <!-- Empty queue -->
        <div v-if="moderationQueue.length === 0" class="rounded-xl border border-[#e2ece3] bg-white p-8 text-center text-sm text-[#667768]">
          <i class="fa-solid fa-shield-check text-3xl text-[#2c6e33] mb-2 block" aria-hidden="true"></i>
          Không có mục nào trong danh sách đối soát. Hệ thống an ninh đang hoạt động tốt.
        </div>

        <!-- Queue list table — Desktop only (≥768px). v-if riêng để không kẹt v-else chain (mobile card ngay sau cũng v-if, không v-else). -->
        <div v-if="moderationQueue.length > 0" class="hidden md:block rounded-xl border border-[#e2ece3] bg-white overflow-x-auto shadow-xs">
          <table class="w-full text-xs">
            <thead class="bg-[#f7faf7] text-left">
              <tr>
                <th class="px-3 py-3 font-bold text-[#122815]">Thời gian</th>
                <th class="px-3 py-3 font-bold text-[#122815]">Nguồn & Vị trí ẩn</th>
                <th class="px-3 py-3 font-bold text-[#122815]">Người gửi / IP</th>
                <th class="px-3 py-3 font-bold text-[#122815]">Nội dung nghi vấn</th>
                <th class="px-3 py-3 font-bold text-[#122815]">Lý do cảnh báo</th>
                <th class="px-3 py-3 font-bold text-[#122815]">Mức độ</th>
                <th class="px-3 py-3 font-bold text-[#122815]">Trạng thái</th>
                <th class="px-3 py-3 font-bold text-[#122815] text-right">Thao tác đối soát</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in moderationQueue" :key="item.id" class="border-t border-[#e2ece3] hover:bg-[#fcfdfc]">
                <td class="px-3 py-2.5 whitespace-nowrap text-[#667768]">{{ formatTime(item.createdAt) }}</td>
                <td class="px-3 py-2.5">
                  <span class="inline-block px-2 py-0.5 rounded font-bold uppercase text-[0.65rem]" :class="item.targetType === 'comment' ? 'bg-blue-100 text-blue-800' : item.targetType === 'chat' ? 'bg-purple-100 text-purple-800' : item.targetType === 'livestream_chat' ? 'bg-orange-100 text-orange-800' : 'bg-gray-100 text-gray-800'">
                    {{ item.targetType === 'comment' ? 'Bình luận' : item.targetType === 'chat' ? 'Chat AI' : item.targetType === 'livestream_chat' ? 'Livestream' : 'Bài viết' }}
                  </span>
                  <div v-if="item.contextTitle" class="mt-1 max-w-[220px]">
                    <a v-if="item.contextUrl" :href="item.contextUrl" target="_blank" class="block font-bold text-[#1e4620] hover:underline truncate text-xs" :title="item.contextTitle">
                      {{ item.contextTitle }}
                    </a>
                    <span v-else class="block font-bold text-[#1e4620] truncate text-xs" :title="item.contextTitle">
                      {{ item.contextTitle }}
                    </span>
                  </div>
                  <div v-if="item.sessionId" class="mt-0.5">
                    <nuxt-link :to="`/admin/chatbot/sessions?search=${encodeURIComponent(item.sessionId)}`" class="text-[0.68rem] font-mono text-[#6b7280] hover:text-[#1e4620] underline">
                      Session: {{ item.sessionId.slice(0, 8) }}...
                    </nuxt-link>
                  </div>
                </td>
                <td class="px-3 py-2.5 whitespace-nowrap">
                  <strong class="text-[#122815]">{{ item.authorName || 'Khách' }}</strong>
                  <div v-if="item.authorIp" class="flex items-center gap-1.5 mt-0.5">
                    <span class="text-[0.68rem] text-[#667768] font-mono">{{ item.authorIp }}</span>
                    <span v-if="item.isIpBanned" class="px-1.5 py-0.2 rounded text-[0.62rem] font-bold bg-red-100 text-red-700 border border-red-200">
                      Đã cấm
                    </span>
                  </div>
                </td>
                <td class="px-3 py-2.5 max-w-xs break-words">
                  <p class="m-0 text-red-900 bg-red-50 p-2 rounded border border-red-200 text-xs leading-relaxed font-medium">
                    {{ item.contentSnippet }}
                  </p>
                </td>
                <td class="px-3 py-2.5 max-w-[220px] break-words text-xs text-[#b42318]">
                  {{ item.flaggedReason }}
                </td>
                <td class="px-3 py-2.5 whitespace-nowrap">
                  <span class="px-2 py-0.5 rounded-full font-bold text-[0.65rem] uppercase" :class="item.severity === 'critical' ? 'bg-red-600 text-white' : item.severity === 'high' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'">
                    {{ item.severity === 'critical' ? 'Nguy hiểm' : item.severity === 'high' ? 'Cao' : 'Trung bình' }}
                  </span>
                </td>
                <td class="px-3 py-2.5 whitespace-nowrap">
                  <span class="px-2 py-0.5 rounded-full font-bold text-[0.65rem]" :class="item.status === 'pending' ? 'bg-orange-100 text-orange-800 border border-orange-300' : item.status === 'approved' ? 'bg-green-100 text-green-800' : item.status === 'banned' ? 'bg-gray-800 text-white' : 'bg-red-100 text-red-800'">
                    {{ item.status === 'pending' ? 'Đã ẩn (Chờ duyệt)' : item.status === 'approved' ? 'Đã duyệt an toàn' : item.status === 'banned' ? 'Đã cấm IP' : 'Đã xóa' }}
                  </span>
                </td>
                <td class="px-3 py-2.5 whitespace-nowrap text-right">
                  <div class="flex items-center justify-end gap-1.5 flex-wrap">
                    <button
                      v-if="item.status === 'pending'"
                      type="button"
                      class="px-2 py-1 rounded bg-[#2c6e33] hover:bg-[#1e4620] text-white text-[0.7rem] font-bold cursor-pointer border-none"
                      title="Duyệt nội dung an toàn và hiển thị công khai lại"
                      @click="resolveQueueItem(item, 'approve')"
                    >
                      <i class="fa-solid fa-check mr-1" aria-hidden="true"></i> Bỏ ẩn
                    </button>
                    <button
                      v-if="item.status !== 'rejected'"
                      type="button"
                      class="px-2 py-1 rounded bg-[#fee2e2] hover:bg-[#fca5a5] text-[#b42318] text-[0.7rem] font-bold cursor-pointer border-none"
                      title="Xóa vĩnh viễn nội dung vi phạm"
                      @click="resolveQueueItem(item, 'reject_delete')"
                    >
                      <i class="fa-solid fa-trash-can mr-1" aria-hidden="true"></i> Xóa
                    </button>
                    <button
                      v-if="item.authorIp"
                      type="button"
                      class="px-2 py-1 rounded text-[0.7rem] font-bold cursor-pointer border flex items-center gap-1"
                      :class="item.isIpBanned
                        ? 'bg-gray-100 text-gray-400 border-gray-300 cursor-not-allowed'
                        : 'bg-[#991b1b] hover:bg-[#7f1d1d] text-white border-transparent shadow-xs'"
                      :disabled="item.isIpBanned"
                      :title="item.isIpBanned ? 'Địa chỉ IP này đã bị cấm' : `Cấm địa chỉ IP ${item.authorIp}`"
                      @click="resolveQueueItem(item, 'ban_ip')"
                    >
                      <i class="fa-solid fa-ban mr-1" aria-hidden="true"></i>
                      <span>{{ item.isIpBanned ? 'Đã cấm IP' : 'Cấm IP' }}</span>
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Mobile card list — Phone only. Dùng v-if riêng (cùng điều kiện desktop) chứ không v-else (sẽ match sai v-else desktop ở trên). -->
        <div v-if="moderationQueue.length > 0" class="md:hidden flex flex-col gap-3">
          <article
            v-for="item in moderationQueue"
            :key="'m-'+item.id"
            class="rounded-xl border border-[#e2ece3] bg-white p-4 flex flex-col gap-2.5 shadow-xs"
          >
            <!-- Header: type chip + status badge -->
            <div class="flex items-start justify-between gap-2.5">
              <div class="flex flex-wrap items-center gap-1.5">
                <span class="inline-block px-2 py-0.5 rounded font-bold uppercase text-[0.65rem]" :class="item.targetType === 'comment' ? 'bg-blue-100 text-blue-800' : item.targetType === 'chat' ? 'bg-purple-100 text-purple-800' : item.targetType === 'livestream_chat' ? 'bg-orange-100 text-orange-800' : 'bg-gray-100 text-gray-800'">
                  {{ item.targetType === 'comment' ? 'Bình luận' : item.targetType === 'chat' ? 'Chat AI' : item.targetType === 'livestream_chat' ? 'Livestream' : 'Bài viết' }}
                </span>
                <span class="px-2 py-0.5 rounded-full font-bold text-[0.65rem]" :class="item.status === 'pending' ? 'bg-orange-100 text-orange-800 border border-orange-300' : item.status === 'approved' ? 'bg-green-100 text-green-800' : item.status === 'banned' ? 'bg-gray-800 text-white' : 'bg-red-100 text-red-800'">
                  {{ item.status === 'pending' ? 'Đã ẩn (Chờ duyệt)' : item.status === 'approved' ? 'Đã duyệt an toàn' : item.status === 'banned' ? 'Đã cấm IP' : 'Đã xóa' }}
                </span>
              </div>
              <span class="px-2 py-0.5 rounded-full font-bold text-[0.65rem] uppercase flex-shrink-0" :class="item.severity === 'critical' ? 'bg-red-600 text-white' : item.severity === 'high' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'">
                {{ item.severity === 'critical' ? 'Nguy hiểm' : item.severity === 'high' ? 'Cao' : 'Trung bình' }}
              </span>
            </div>

            <!-- Thời gian -->
            <p class="m-0 text-xs text-[#667768]"><i class="fa-regular fa-clock mr-1" aria-hidden="true"></i>{{ formatTime(item.createdAt) }}</p>

            <!-- Context title -->
            <div v-if="item.contextTitle" class="min-w-0">
              <a v-if="item.contextUrl" :href="item.contextUrl" target="_blank" class="block font-bold text-[#1e4620] hover:underline truncate text-xs" :title="item.contextTitle">
                {{ item.contextTitle }}
              </a>
              <span v-else class="block font-bold text-[#1e4620] truncate text-xs" :title="item.contextTitle">
                {{ item.contextTitle }}
              </span>
            </div>
            <nuxt-link v-if="item.sessionId" :to="`/admin/chatbot/sessions?search=${encodeURIComponent(item.sessionId)}`" class="text-[0.68rem] font-mono text-[#6b7280] hover:text-[#1e4620] underline self-start">
              Session: {{ item.sessionId.slice(0, 8) }}...
            </nuxt-link>

            <!-- Người gửi + IP -->
            <div class="flex flex-wrap items-center gap-1.5 text-xs">
              <strong class="text-[#122815]">{{ item.authorName || 'Khách' }}</strong>
              <span v-if="item.authorIp" class="text-[0.68rem] text-[#667768] font-mono">{{ item.authorIp }}</span>
              <span v-if="item.isIpBanned" class="px-1.5 py-0.2 rounded text-[0.62rem] font-bold bg-red-100 text-red-700 border border-red-200">Đã cấm</span>
            </div>

            <!-- Nội dung snippet -->
            <p class="m-0 text-red-900 bg-red-50 p-2 rounded border border-red-200 text-xs leading-relaxed font-medium break-words">
              {{ item.contentSnippet }}
            </p>

            <!-- Lý do cảnh báo -->
            <p class="m-0 text-xs text-[#b42318] break-words">
              <strong>Lý do:</strong> {{ item.flaggedReason }}
            </p>

            <!-- Action buttons — full-width trên mobile, dễ bấm -->
            <div class="flex flex-wrap gap-2 pt-1 border-t border-[#eef3ee]">
              <button
                v-if="item.status === 'pending'"
                type="button"
                class="flex-1 min-w-[110px] px-3 py-2.5 rounded-lg bg-[#2c6e33] hover:bg-[#1e4620] text-white text-[0.78rem] font-bold cursor-pointer border-none"
                @click="resolveQueueItem(item, 'approve')"
              >
                <i class="fa-solid fa-check mr-1" aria-hidden="true"></i> Bỏ ẩn
              </button>
              <button
                v-if="item.status !== 'rejected'"
                type="button"
                class="flex-1 min-w-[110px] px-3 py-2.5 rounded-lg bg-[#fee2e2] hover:bg-[#fca5a5] text-[#b42318] text-[0.78rem] font-bold cursor-pointer border-none"
                @click="resolveQueueItem(item, 'reject_delete')"
              >
                <i class="fa-solid fa-trash-can mr-1" aria-hidden="true"></i> Xóa
              </button>
              <button
                v-if="item.authorIp"
                type="button"
                class="flex-1 min-w-[110px] px-3 py-2.5 rounded-lg text-[0.78rem] font-bold cursor-pointer border flex items-center justify-center gap-1"
                :class="item.isIpBanned
                  ? 'bg-gray-100 text-gray-400 border-gray-300 cursor-not-allowed'
                  : 'bg-[#991b1b] hover:bg-[#7f1d1d] text-white border-transparent shadow-xs'"
                :disabled="item.isIpBanned"
                @click="resolveQueueItem(item, 'ban_ip')"
              >
                <i class="fa-solid fa-ban" aria-hidden="true"></i>
                <span>{{ item.isIpBanned ? 'Đã cấm IP' : 'Cấm IP' }}</span>
              </button>
            </div>
          </article>
        </div>
      </div>

      <!-- ── SUBTAB 2: SECURITY RULES ── -->
      <div v-if="moderationSubTab === 'rules'" class="flex flex-col gap-5">
        <!-- Add Rule Form -->
        <div class="rounded-xl border border-[#c8d6c9] bg-[#f0f7f1] p-4 flex flex-col gap-3 shadow-xs">
          <h3 class="m-0 text-sm font-extrabold text-[#122815] flex items-center gap-2">
            <i class="fa-solid fa-plus-circle text-[#2c6e33]" aria-hidden="true"></i>
            Thêm quy tắc / Từ khóa kiểm duyệt an ninh mới
          </h3>
          <form class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5 items-end" @submit.prevent="addModerationRule">
            <label class="flex flex-col gap-1 text-xs font-bold text-[#122815]">
              Nhóm vi phạm
              <select v-model="newRuleForm.category" class="rounded-lg border border-[#c8d6c9] px-2.5 py-2 text-xs bg-white">
                <option value="hostile_forces">Thế lực thù địch / Phản động</option>
                <option value="anti_state">Chống phá / Xuyên tạc chính sách</option>
                <option value="defamation">Bôi nhọ / Xúc phạm uy tín</option>
                <option value="spam_fraud">Spam / Cờ bạc / Lừa đảo</option>
                <option value="profanity">Từ ngữ thô tục</option>
                <option value="custom">Tùy biến</option>
              </select>
            </label>

            <label class="flex flex-col gap-1 text-xs font-bold text-[#122815] lg:col-span-2">
              Từ khóa / Mẫu nhận diện (Pattern)
              <input
                v-model="newRuleForm.pattern"
                type="text"
                placeholder="Nhập từ khóa hoặc cụm từ vi phạm..."
                class="rounded-lg border border-[#c8d6c9] px-3 py-2 text-xs bg-white outline-none focus:border-[#2c6e33]"
                required
              />
            </label>

            <label class="flex flex-col gap-1 text-xs font-bold text-[#122815]">
              Hành động xử lý
              <select v-model="newRuleForm.action" class="rounded-lg border border-[#c8d6c9] px-2.5 py-2 text-xs bg-white">
                <option value="auto_hide">Tự động ẩn ngay lập tức</option>
                <option value="flag_only">Chỉ gắn cờ cảnh báo</option>
              </select>
            </label>

            <button
              type="submit"
              class="px-4 py-2 rounded-lg bg-[#2c6e33] hover:bg-[#1e4620] text-white text-xs font-bold cursor-pointer border-none shadow-xs w-full sm:w-auto"
            >
              + Thêm quy tắc
            </button>
          </form>
        </div>

        <!-- Rules List Table — Desktop only (table 6 cột) -->
        <div class="hidden md:block rounded-xl border border-[#e2ece3] bg-white overflow-x-auto shadow-xs">
          <table class="w-full text-xs">
            <thead class="bg-[#f7faf7] text-left">
              <tr>
                <th class="px-3 py-3 font-bold text-[#122815]">Nhóm danh mục</th>
                <th class="px-3 py-3 font-bold text-[#122815]">Từ khóa / Mẫu nhận diện</th>
                <th class="px-3 py-3 font-bold text-[#122815]">Hành động</th>
                <th class="px-3 py-3 font-bold text-[#122815]">Mức độ</th>
                <th class="px-3 py-3 font-bold text-[#122815]">Trạng thái</th>
                <th class="px-3 py-3 font-bold text-[#122815] text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in moderationRules" :key="r.id" class="border-t border-[#e2ece3] hover:bg-[#fcfdfc]">
                <td class="px-3 py-2.5 font-bold text-[#122815]">
                  {{ RULE_CATEGORY_LABELS[r.category] || r.category }}
                </td>
                <td class="px-3 py-2.5 font-mono text-[#b42318] font-bold">
                  "{{ r.pattern }}"
                </td>
                <td class="px-3 py-2.5">
                  <span class="px-2 py-0.5 rounded text-[0.68rem] font-bold" :class="r.action === 'auto_hide' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'">
                    {{ r.action === 'auto_hide' ? 'Tự động ẩn ngay' : 'Chỉ cảnh báo' }}
                  </span>
                </td>
                <td class="px-3 py-2.5">
                  <span class="px-2 py-0.5 rounded-full text-[0.65rem] font-bold uppercase" :class="r.severity === 'critical' ? 'bg-red-600 text-white' : r.severity === 'high' ? 'bg-orange-100 text-orange-800' : 'bg-gray-100 text-gray-800'">
                    {{ r.severity }}
                  </span>
                </td>
                <td class="px-3 py-2.5">
                  <button
                    type="button"
                    class="px-2.5 py-1 rounded text-xs font-semibold cursor-pointer border"
                    :class="r.isEnabled ? 'bg-green-100 text-green-800 border-green-300' : 'bg-gray-100 text-gray-500 border-gray-300'"
                    @click="toggleModerationRule(r)"
                  >
                    {{ r.isEnabled ? 'Đang bật' : 'Đã tắt' }}
                  </button>
                </td>
                <td class="px-3 py-2.5 text-right">
                  <button
                    type="button"
                    class="text-xs text-[#b42318] hover:underline cursor-pointer border-none bg-transparent"
                    @click="deleteModerationRule(r)"
                  >
                    Xóa
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Rules card list — Mobile only -->
        <div class="md:hidden flex flex-col gap-3">
          <article
            v-for="r in moderationRules"
            :key="'r-'+r.id"
            class="rounded-xl border border-[#e2ece3] bg-white p-4 flex flex-col gap-2.5 shadow-xs"
          >
            <!-- Header: category + status toggle -->
            <div class="flex items-start justify-between gap-2.5">
              <div class="min-w-0 flex-1">
                <p class="m-0 font-bold text-[#122815] text-sm">{{ RULE_CATEGORY_LABELS[r.category] || r.category }}</p>
                <p class="m-0 mt-1 font-mono text-[#b42318] font-bold text-xs break-all">"{{ r.pattern }}"</p>
              </div>
              <button
                type="button"
                class="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer border"
                :class="r.isEnabled ? 'bg-green-100 text-green-800 border-green-300' : 'bg-gray-100 text-gray-500 border-gray-300'"
                @click="toggleModerationRule(r)"
              >
                {{ r.isEnabled ? 'Đang bật' : 'Đã tắt' }}
              </button>
            </div>

            <!-- Hành động + Mức độ chip side-by-side -->
            <div class="flex flex-wrap items-center gap-2">
              <span class="px-2 py-0.5 rounded text-[0.7rem] font-bold" :class="r.action === 'auto_hide' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'">
                {{ r.action === 'auto_hide' ? 'Tự động ẩn ngay' : 'Chỉ cảnh báo' }}
              </span>
              <span class="px-2 py-0.5 rounded-full text-[0.68rem] font-bold uppercase" :class="r.severity === 'critical' ? 'bg-red-600 text-white' : r.severity === 'high' ? 'bg-orange-100 text-orange-800' : 'bg-gray-100 text-gray-800'">
                {{ r.severity }}
              </span>
            </div>

            <!-- Footer: Xóa -->
            <div class="pt-2 border-t border-[#eef3ee]">
              <button
                type="button"
                class="px-3 py-2 rounded-lg bg-[#fee2e2] hover:bg-[#fca5a5] text-[#b42318] text-[0.78rem] font-bold cursor-pointer border-none w-full"
                @click="deleteModerationRule(r)"
              >
                <i class="fa-solid fa-trash-can mr-1" aria-hidden="true"></i> Xóa quy tắc
              </button>
            </div>
          </article>
        </div>
      </div>
    </template>
  </div>
</template>
