<template>
  <div class="flex flex-col gap-5">
    <header class="flex flex-col gap-1">
      <div class="flex items-center gap-2">
        <span class="w-8 h-8 rounded-lg bg-brand-900 text-white flex items-center justify-center text-sm shadow-xs">
          <i class="fa-solid fa-shield-halved"></i>
        </span>
        <h1 class="m-0 text-[1.35rem] font-extrabold text-brand-950">Kiểm duyệt An ninh & An toàn Nội dung</h1>
      </div>
      <p class="m-0 mt-1 text-sm text-ink-muted">
        Hệ thống kiểm duyệt an ninh tự động: đọc hiểu ngữ cảnh AI, tự động phát hiện và ẩn nội dung xấu độc, thù địch, chống phá, lừa đảo theo quy định của Cục C11 - Bộ Công an.
      </p>
    </header>

    <!-- Error Alert — the page load (loadData). Later re-reads fail on their own tab (#error slots below). -->
    <div v-if="error" :class="ALERT_CLASS" role="alert">
      <strong>Lỗi:</strong> {{ error }}
      <button type="button" :class="RETRY_CLASS" @click="loadData">Thử lại</button>
    </div>

    <!-- Tab navigation -->
    <nav class="flex flex-wrap gap-2 bg-white p-2 rounded-xl border border-line">
      <button
        v-for="t in ([
          { key: 'settings', label: '⚙️ Cài đặt Kiểm duyệt AI', icon: 'fa-solid fa-sliders', badge: 0, count: undefined as number | undefined },
          { key: 'queue', label: '📥 Sổ đối soát nội dung bị ẩn', icon: 'fa-solid fa-inbox', badge: pendingQueueCount, count: undefined as number | undefined },
          { key: 'rules', label: '📋 Quy tắc & Từ khóa an ninh', icon: 'fa-solid fa-list-check', badge: 0, count: rules.length },
          { key: 'worker', label: '⚡ Trạng thái Worker & Hệ thống', icon: 'fa-solid fa-server', badge: 0, count: undefined as number | undefined },
        ] as const)"
        :key="t.key"
        type="button"
        class="flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer border"
        :class="activeTab === t.key
          ? 'bg-brand-900 text-white border-brand-900 shadow-xs'
          : 'bg-white text-ink-muted border-transparent hover:bg-surface-tint hover:text-brand-900'"
        @click="activeTab = t.key"
      >
        <span>{{ t.label }}</span>
        <span v-if="t.badge !== null && t.badge > 0" class="px-1.5 py-px rounded-full bg-red-500 text-white text-[0.65rem] font-black">
          {{ t.badge }}
        </span>
        <span v-else-if="t.count !== undefined" class="text-[0.7rem] opacity-70">
          ({{ t.count }})
        </span>
      </button>

      <button
        type="button"
        class="ml-auto px-3 py-1.5 rounded-lg border border-line-strong bg-white text-xs font-semibold text-brand-900 hover:bg-surface-tint transition-colors cursor-pointer flex items-center gap-1.5"
        :disabled="loading"
        @click="loadData"
      >
        <i class="fa-solid fa-rotate text-xs" :class="loading ? 'animate-spin' : ''"></i>
        <span>Làm mới</span>
      </button>
    </nav>

    <!-- Skeleton Loading -->
    <div v-if="loading" role="status" aria-busy="true" class="flex flex-col gap-4">
      <span class="sr-only">Đang tải dữ liệu kiểm duyệt an ninh</span>
      <div v-for="n in 3" :key="n" class="h-28 rounded-xl bg-white border border-line animate-pulse motion-reduce:animate-none" aria-hidden="true"></div>
    </div>

    <!-- Main Content Tabs — each tab is a presentational panel; state and requests stay here. -->
    <template v-else-if="!error">
      <ModerationSettingsPanel
        v-if="activeTab === 'settings'"
        v-model:enabled="form.enabled"
        v-model:mode="form.mode"
        v-model:provider="form.provider"
        v-model:model="form.model"
        v-model:system-prompt="form.systemPrompt"
        :default-system-prompt="form.defaultSystemPrompt"
        :active-providers="activeProviders"
        :active-models="activeModels"
        :saving="saving"
        @save="saveSettings"
      >
        <template v-if="settingsError" #error>
          <div :class="ALERT_CLASS" role="alert">
            <strong>Lỗi:</strong> {{ settingsError }}
            <button type="button" :class="RETRY_CLASS" @click="reloadSettings">Thử lại</button>
          </div>
        </template>
      </ModerationSettingsPanel>

      <ModerationQueuePanel
        v-else-if="activeTab === 'queue'"
        :queue="queue"
        :queue-status-filter="queueList.filters.status"
        :queue-page="queuePage"
        :queue-total-pages="queueTotalPages"
        :queue-total="queueTotal"
        @select-filter="selectQueueFilter"
        @change-page="queueList.goToPage"
        @resolve="resolveItem"
      >
        <template v-if="queueError" #error>
          <div :class="ALERT_CLASS" role="alert">
            <strong>Lỗi:</strong> {{ queueError }}
            <button type="button" :class="RETRY_CLASS" @click="loadQueue">Thử lại</button>
          </div>
        </template>
      </ModerationQueuePanel>

      <ModerationRulesPanel
        v-else-if="activeTab === 'rules'"
        v-model:category="newRuleForm.category"
        v-model:pattern="newRuleForm.pattern"
        v-model:action="newRuleForm.action"
        :rules="rules"
        @add="addRule"
        @toggle="toggleRule"
        @delete="deleteRule"
      >
        <template v-if="rulesError" #error>
          <div :class="ALERT_CLASS" role="alert">
            <strong>Lỗi:</strong> {{ rulesError }}
            <button type="button" :class="RETRY_CLASS" @click="reloadRules">Thử lại</button>
          </div>
        </template>
      </ModerationRulesPanel>

      <ModerationWorkerPanel
        v-else-if="activeTab === 'worker'"
        :worker-data="workerData"
        :worker-loading="workerLoading"
        :rescan-busy="rescanBusy"
        :rescan-progress-text="rescanProgressText"
        :rescan-ai-unavailable-text="rescanAiUnavailableText"
        :restarting-worker="restartingWorker"
        :restarting-server="restartingServer"
        @refresh="loadWorkerStatus"
        @rescan-all="triggerRescanAll"
        @restart-worker="triggerRestartWorker"
        @restart-server="triggerRestartServer"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, type Ref } from 'vue'
import { pendingBadgeCount } from '~/utils/moderation-summary'
import { useModerationWorker } from '~/composables/useModerationWorker'
import type { AdminListPage } from '~/composables/useAdminList'
import type {
  ModerationMode, ModerationModelOption, ModerationProviderOption, ModerationQueueItem, ModerationQueueResponse,
  ModerationResolveAction, ModerationResolveResponse, ModerationRule, ModerationRuleCreateResponse,
  ModerationRuleDeleteResponse, ModerationRuleUpdateResponse, ModerationRulesResponse, ModerationSettingsResponse,
  ModerationSettingsSaveResponse, ModerationTabKey,
} from '~/types/moderation'
import ModerationSettingsPanel from '~/components/admin/ai/moderation/ModerationSettingsPanel.vue'
import ModerationQueuePanel from '~/components/admin/ai/moderation/ModerationQueuePanel.vue'
import ModerationRulesPanel from '~/components/admin/ai/moderation/ModerationRulesPanel.vue'
import ModerationWorkerPanel from '~/components/admin/ai/moderation/ModerationWorkerPanel.vue'

definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

/**
 * The four tabs are presentational panels (`app/components/admin/ai/moderation/*`); the
 * worker tab's status, rescan and restarts are `useModerationWorker`. This page keeps the
 * state, every request and every error branch with its retry — tests/admin-error-retry-ui
 * reads this file. Two kinds of failure, kept apart on purpose:
 *   - the PAGE load (`loadData`) → `error`, the alert above the tabs, "Thử lại" = loadData;
 *   - a re-read AFTER it (queue filter/page/reload, settings or rules after a write) → the
 *     alert on that tab only (`#error` slot): the other tabs, and unsaved edits in them, stay.
 * Behaviour: tests/admin-moderation-page.test.ts. Why: docs/decisions/refactor-large-files.md.
 */

const toast = useToast()
const { confirm } = useConfirm()

const activeTab = ref<ModerationTabKey>('settings')

const loading = ref(true)
const error = ref('')
const settingsError = ref('')
const rulesError = ref('')
const saving = ref(false)
/** The page alert and each tab's alert look the same. */
const ALERT_CLASS = 'rounded-lg border border-[#f1b8b5] bg-danger-bg p-3 text-sm text-[#a32924]'
const RETRY_CLASS = 'font-bold underline text-brand-600 ml-2 cursor-pointer'

const form = reactive({
  enabled: true,
  mode: 'ai' as ModerationMode,
  provider: 'delify',
  model: 'delify-5.5',
  systemPrompt: '',
  defaultSystemPrompt: '',
})

const activeProviders = ref<ModerationProviderOption[]>([])
const activeModels = ref<ModerationModelOption[]>([])
const rules = ref<ModerationRule[]>([])

/**
 * Review queue: status filter + paging, 20 per page. `useAdminList` lets only the LATEST
 * request write the rows (an older filter's answer landing last used to replace them),
 * and asks once more for the last page when the one shown has emptied. `status` travels
 * with each answer — the filter of THAT request, snapshotted when it was sent.
 */
const QUEUE_PER_PAGE = 20
type QueuePage = AdminListPage<ModerationQueueItem> & { status: string }
const queueList = useAdminList<ModerationQueueItem, { status: string }, QueuePage>({
  filters: { status: 'pending' },
  // The page load's own fallback: a queue failing on mount reads as it always did.
  errorFallback: 'Không thể tải cấu hình kiểm duyệt an ninh.',
  load: async ({ page, filters, signal }) => {
    const res = await adminFetch<ModerationQueueResponse>('/api/admin/ai/moderation/queue', {
      query: { status: filters.status, page, perPage: QUEUE_PER_PAGE },
      signal,
    })
    return { ...res, status: filters.status }
  },
})
const { items: queue, page: queuePage, totalPages: queueTotalPages, total: queueTotal } = queueList
const queueError = computed(() => queueList.error.value)

const {
  workerData, workerLoading, workerPendingCount, rescanBusy, rescanProgressText, rescanAiUnavailableText,
  restartingWorker, restartingServer, loadWorkerStatus, triggerRestartWorker, triggerRescanAll, triggerRestartServer,
} = useModerationWorker({ toast, confirm, onRescanFinished: () => { void loadQueue() } })

// Tổng của máy chủ, không đếm trên trang 20 dòng (lỗi trần 20) — cùng con số với bản
// tóm tắt ở tab AI Panel. `queueTotalFilter` = bộ lọc mà `queueTotal` ĐÃ TẢI thuộc về
// (theo phản hồi, không theo nút vừa bấm), để vừa đổi bộ lọc không hiện tổng của bộ lọc trước.
const queueTotalFilter = computed(() => queueList.result.value?.status ?? null)
const pendingQueueCount = computed(() => pendingBadgeCount({ queueTotal: queueTotal.value, queueTotalFilter: queueTotalFilter.value, workerPending: workerPendingCount.value }))

const newRuleForm = reactive({
  category: 'hostile_forces',
  ruleType: 'keyword',
  pattern: '',
  action: 'auto_hide',
  severity: 'critical',
})

async function loadSettings() {
  const res = await adminFetch<ModerationSettingsResponse>('/api/admin/ai/moderation/settings')

  form.enabled = res.settings.enabled
  form.mode = res.settings.mode
  form.provider = res.settings.provider
  form.model = res.settings.model
  form.systemPrompt = res.settings.systemPrompt
  form.defaultSystemPrompt = res.settings.defaultSystemPrompt

  activeProviders.value = res.activeProviders
  activeModels.value = res.activeModels
}

/** Re-read the current queue page (also its tab's "Thử lại"); never rejects — the failure is `queueError`. */
async function loadQueue() {
  await queueList.reload()
}

function selectQueueFilter(status: string) {
  queueList.filters.status = status
  void queueList.applyFilters()
}

async function loadRules() {
  const res = await adminFetch<ModerationRulesResponse>('/api/admin/ai/moderation/rules')
  rules.value = res.rules
}

async function loadData() {
  loading.value = true
  error.value = ''
  settingsError.value = ''
  rulesError.value = ''
  try {
    await Promise.all([loadSettings(), loadQueue(), loadRules(), loadWorkerStatus()])
    // The list keeps its failure (`loadQueue` never rejects); on the PAGE load a failed
    // queue is a failed page load, as it always was.
    if (queueError.value) error.value = queueError.value
  } catch (err: unknown) {
    error.value = errorMessage(err, 'Không thể tải cấu hình kiểm duyệt an ninh.')
  } finally {
    loading.value = false
  }
}

/**
 * Re-read one tab after the page load — after a write, or its own "Thử lại". A failure
 * stays on that tab: never the page alert, which hides every tab and whose "Thử lại"
 * (loadData) would overwrite unsaved edits in the others.
 */
async function reloadInto(failure: Ref<string>, load: () => Promise<void>, fallback: string) {
  failure.value = ''
  try {
    await load()
  } catch (err: unknown) {
    failure.value = errorMessage(err, fallback)
  }
}
const reloadSettings = () => reloadInto(settingsError, loadSettings, 'Không thể tải lại cấu hình kiểm duyệt an ninh.')
const reloadRules = () => reloadInto(rulesError, loadRules, 'Không thể tải lại danh sách quy tắc.')

/**
 * One write. A failure toasts the server's sentence (or `fallback`) and gives `false`.
 * The re-read after a success is NOT part of it: its failure is a re-read failure, shown
 * on the tab, never "the write failed" under the success toast.
 */
async function write(request: () => Promise<unknown>, fallback: string): Promise<boolean> {
  try {
    await request()
    return true
  } catch (err: unknown) {
    toast.error(errorMessage(err, fallback))
    return false
  }
}

async function saveSettings() {
  saving.value = true
  const body = {
    enabled: form.enabled,
    mode: form.mode,
    provider: form.provider,
    model: form.model,
    systemPrompt: form.systemPrompt,
  }
  if (await write(() => adminFetch<ModerationSettingsSaveResponse>('/api/admin/ai/moderation/settings', { method: 'PUT', body }), 'Không thể lưu cấu hình.')) {
    toast.success('Đã lưu cấu hình kiểm duyệt an ninh!')
    await reloadSettings()
  }
  saving.value = false
}

async function addRule() {
  if (!newRuleForm.pattern.trim()) {
    toast.warning('Vui lòng nhập từ khóa hoặc mẫu nhận diện.')
    return
  }
  if (!(await write(() => adminFetch<ModerationRuleCreateResponse>('/api/admin/ai/moderation/rules', { method: 'POST', body: newRuleForm }), 'Không thể thêm quy tắc.'))) return
  toast.success('Đã thêm quy tắc an ninh mới!')
  newRuleForm.pattern = ''
  await reloadRules()
}

async function toggleRule(rule: ModerationRule) {
  try {
    await adminFetch<ModerationRuleUpdateResponse>(`/api/admin/ai/moderation/rules/${rule.id}`, {
      method: 'PUT',
      body: { isEnabled: !rule.isEnabled },
    })
    rule.isEnabled = !rule.isEnabled
    toast.success(`Đã ${rule.isEnabled ? 'bật' : 'tắt'} quy tắc.`)
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể cập nhật quy tắc.'))
  }
}

async function deleteRule(rule: ModerationRule) {
  const ok = await confirm({
    title: 'Xóa quy tắc kiểm duyệt',
    message: `Bạn có chắc muốn xóa quy tắc "${rule.pattern}"?`,
    confirmText: 'Xóa',
    tone: 'danger',
  })
  if (!ok) return

  if (!(await write(() => adminFetch<ModerationRuleDeleteResponse>(`/api/admin/ai/moderation/rules/${rule.id}`, { method: 'DELETE' }), 'Không thể xóa quy tắc.'))) return
  toast.success('Đã xóa quy tắc.')
  await reloadRules()
}

async function resolveItem(item: ModerationQueueItem, action: ModerationResolveAction) {
  let confirmMsg = 'Xác nhận xử lý?'
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

  const body = { action }
  if (!(await write(() => adminFetch<ModerationResolveResponse>(`/api/admin/ai/moderation/queue/${item.id}/resolve`, { method: 'POST', body }), 'Không thể xử lý đối soát.'))) return
  toast.success('Đã xử lý đối soát thành công!')
  // Số "pending" của worker-status cũng đổi (huy hiệu khi đang lọc trạng thái khác).
  // Hàng đợi tải lại hỏng hiện trên tab của nó (`queueError`), không thành toast "không xử lý được".
  await Promise.all([loadQueue(), loadWorkerStatus()])
}

onMounted(loadData)
</script>
