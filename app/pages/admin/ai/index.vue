<script setup lang="ts">
import { errorMessage } from '~/utils/errorMessage'
definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

// Provider presets for the "Add Provider" form
const PROVIDER_PRESETS = [
  { value: 'delify', label: 'Delify Router', baseUrl: 'https://router.delify.vn/v1', hint: 'glm-5.3, claude-opus-5, flash — hỗ trợ tự động tải model & giá' },
  { value: 'google', label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', hint: 'Gemini 1.5 Flash / Pro' },
  { value: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', hint: 'GPT-4o, GPT-4o-mini' },
  { value: 'anthropic', label: 'Anthropic Claude', baseUrl: 'https://api.anthropic.com/v1', hint: 'Claude 3.5 Sonnet / Haiku' },
  { value: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', hint: 'DeepSeek-V3 / R1' },
  { value: 'custom', label: 'Tùy chỉnh (OpenAI-compatible)', baseUrl: '', hint: 'Bất kỳ API tương thích OpenAI nào' },
]

type Tab = 'dashboard' | 'providers' | 'services' | 'moderation' | 'logs'
const activeTab = ref<Tab>('dashboard')

// ── Tab state ──────────────────────────────────────────────────────────
const tabs: Array<{ key: Tab; label: string; icon: string }> = [
  { key: 'dashboard', label: 'Tổng quan', icon: 'fa-solid fa-chart-pie' },
  { key: 'providers', label: 'Nhà cung cấp & Models', icon: 'fa-solid fa-plug' },
  { key: 'services', label: 'Prompt dịch vụ', icon: 'fa-solid fa-comment-code' },
  { key: 'moderation', label: '🛡️ Kiểm duyệt An ninh', icon: 'fa-solid fa-shield-halved' },
  { key: 'logs', label: 'Nhật ký gọi', icon: 'fa-solid fa-list-check' },
]

// ── Toast & Confirm ───────────────────────────────────────────────────
const toast = useToast()
const { confirm } = useConfirm()

// ─────────────────────────────────────────────────────────────────────────
// Dashboard Tab
// ─────────────────────────────────────────────────────────────────────────
interface UsageSummary {
  monthlyCostVnd: number
  totalPromptTokens: number
  totalCompletionTokens: number
  totalRequests: number
  successRate: number
}
interface ByServiceRow {
  serviceKey: string
  costVnd: number
  promptTokens: number
  completionTokens: number
  requests: number
}
interface DailyRow { day: string; costVnd: number; requests: number }
interface BudgetInfo { monthlyBudgetVnd: number; warningThresholdPct: number; usagePercent: number }

const usageError = ref(null as string | null)
const usageLoading = ref(false)
const usageSummary = ref<UsageSummary | null>(null)
const byService = ref<ByServiceRow[]>([])
const dailyData = ref<DailyRow[]>([])
const budgetInfo = ref<BudgetInfo | null>(null)

const SERVICE_LABELS: Record<string, string> = {
  chatbot: 'Chatbot',
  translation_article: 'Dịch bài viết',
  translation_ui: 'Dịch UI',
  editorial_assistant: 'Trợ lý biên tập',
  moderation: 'Kiểm duyệt',
  test_call: 'Kiểm tra (Test Call)',
  delify_router: 'Delify Router Gateway',
}

const CHART_COLORS = ['#2c6e33', '#4A6741', '#6b9f47', '#8ed694', '#a8d5a8', '#c2e4c2']

async function loadUsage() {
  usageError.value = null
  usageLoading.value = true
  try {
    const data = await $fetch<{
      usage: UsageSummary
      byService: ByServiceRow[]
      daily: DailyRow[]
      budget: BudgetInfo
    }>('/api/admin/ai/usage')
    usageSummary.value = data.usage
    byService.value = data.byService
    dailyData.value = data.daily
    budgetInfo.value = data.budget
  } catch (err: unknown) {
    usageError.value = errorMessage(err, 'Không thể tải dữ liệu sử dụng.')
  } finally {
    usageLoading.value = false
  }
}

function formatVnd(vnd: number): string {
  return new Intl.NumberFormat('vi-VN').format(Math.round(vnd)) + ' ₫'
}
function formatNum(n: number): string {
  return new Intl.NumberFormat('vi-VN').format(n)
}

const effectiveBudgetVnd = computed(() => {
  if (budgetInfo.value?.monthlyBudgetVnd && budgetInfo.value.monthlyBudgetVnd > 0) {
    return budgetInfo.value.monthlyBudgetVnd
  }
  if (delifyStatus.value?.keyInfo?.budgetUsd != null) {
    return delifyStatus.value.keyInfo.budgetVnd ?? delifyStatus.value.keyInfo.budgetUsd * 25500
  }
  return 0
})

const effectiveUsedVnd = computed(() => {
  return delifyStatus.value?.keyInfo?.usedCostVnd ?? usageSummary.value?.monthlyCostVnd ?? 0
})

const effectiveUsagePercent = computed(() => {
  if (!effectiveBudgetVnd.value || effectiveBudgetVnd.value <= 0) return 0
  return (effectiveUsedVnd.value / effectiveBudgetVnd.value) * 100
})

const budgetColor = computed(() => {
  const pct = effectiveUsagePercent.value
  if (pct >= 100) return 'bg-red-500'
  if (pct >= 80) return 'bg-yellow-500'
  return 'bg-green-500'
})

// ── Delify Router Real-time Status state ──────────────────────────────
interface DelifyStatusResponse {
  ok: boolean
  configured: boolean
  error?: string
  keyInfo?: {
    name: string
    groupName: string
    active: boolean
    budgetUsd: number | null
    budgetVnd?: number | null
    usedCostUsd: number
    usedCostVnd?: number
    remainingBudgetUsd: number | null
    remainingBudgetVnd?: number | null
    totalRequests: number
    allowedModels: string[]
    rpm: number | null
    windowStartedAt: string | null
  }
  period: string
  periodSummary?: {
    items?: Array<{ model: string; input: number; output: number; requests: number; cost: number }>
    totals?: { input: number; output: number; requests: number; cost: number }
  } | null
  recentHistory?: Array<{ timestamp: string; model: string; status: string; cost: number; input: number; output: number; tok: number }>
  availableModels?: Array<{ name: string; input: number; output: number }>
}

const delifyPeriod = ref<'1h' | '24h' | '7d' | '30d' | 'all'>('7d')
const delifyStatus = ref<DelifyStatusResponse | null>(null)
const delifyStatusLoading = ref(false)
const delifyStatusError = ref<string | null>(null)

async function loadDelifyStatus(period: '1h' | '24h' | '7d' | '30d' | 'all' = delifyPeriod.value) {
  delifyPeriod.value = period
  delifyStatusLoading.value = true
  delifyStatusError.value = null
  try {
    const data = await $fetch<DelifyStatusResponse>('/api/admin/ai/delify/status', {
      params: { period },
    })
    delifyStatus.value = data
    if (!data.ok && data.error) {
      delifyStatusError.value = data.error
    }
  } catch (err: unknown) {
    delifyStatusError.value = errorMessage(err, 'Không thể tải trạng thái Delify Router.')
  } finally {
    delifyStatusLoading.value = false
  }
}

const CHART_MAX_HEIGHT = 120
function chartBarHeight(cost: number): number {
  const max = Math.max(...dailyData.value.map(d => d.costVnd), 1)
  return Math.max(2, (cost / max) * CHART_MAX_HEIGHT)
}

const donutSegments = computed(() => {
  const total = byService.value.reduce((sum, s) => sum + s.costVnd, 0)
  let offset = 0
  return byService.value.map((s, i) => {
    const fraction = total > 0 ? s.costVnd / total : 0
    const dash = fraction * 251.2
    const seg = {
      color: CHART_COLORS[i % CHART_COLORS.length],
      dasharray: `${dash} ${251.2 - dash}`,
      dashoffset: -offset,
      label: SERVICE_LABELS[s.serviceKey] ?? s.serviceKey,
      costVnd: s.costVnd,
      fraction,
    }
    offset += dash
    return seg
  })
})

// ─────────────────────────────────────────────────────────────────────────
// Providers & Models Tab (9Router style)
// ─────────────────────────────────────────────────────────────────────────
interface ProviderRow {
  id: number
  provider: string
  label: string
  baseUrl: string | null
  isActive: boolean
  apiKeyLastFour: string | null
  updatedAt: string | null
  totalModels?: number
  activeModels?: number
}

interface PricingRow {
  model: string
  provider: string
  label: string | null
  isActive: boolean
  promptCostPerMillion: number
  completionCostPerMillion: number
  updatedAt?: string | null
}

const providersError = ref(null as string | null)
const providersLoading = ref(false)
const providers = ref<ProviderRow[]>([])
const pricingRows = ref<PricingRow[]>([])

// Accordion open/close per provider (all open by default)
const openProviderPanels = ref<Record<string, boolean>>({})

function toggleProviderPanel(providerName: string) {
  openProviderPanels.value[providerName] = !openProviderPanels.value[providerName]
}

function isProviderPanelOpen(providerName: string): boolean {
  return openProviderPanels.value[providerName] !== false
}

// Filter models for a specific provider
function modelsForProvider(providerName: string): PricingRow[] {
  return pricingRows.value.filter(m => m.provider === providerName)
}

// Provider Edit modal
const editingProvider = ref<ProviderRow | null>(null)
const providerForm = ref({ label: '', baseUrl: '', isActive: false, apiKey: '' })
const savingProvider = ref(false)
const testingProvider = ref<number | null>(null)
const testResult = ref<string | null>(null)

// Create provider modal
const showCreateForm = ref(false)
const newProviderForm = ref({ provider: 'delify', label: 'Delify Router', baseUrl: 'https://router.delify.vn/v1', isActive: true, apiKey: '' })
const newProviderError = ref('')
const savingNewProvider = ref(false)

// Delete provider
const deletingProviderId = ref<number | null>(null)

// Add model to provider modal
const showAddModelModal = ref(false)
const targetProviderForModel = ref<string>('')
const newModelForm = ref({ model: '', label: '', promptCostPerMillion: 1.0, completionCostPerMillion: 4.0, isActive: true })
const newModelError = ref('')
const savingNewModel = ref(false)

// Edit model modal
const editingModel = ref<PricingRow | null>(null)
const editModelForm = ref({ label: '', promptCostPerMillion: 0, completionCostPerMillion: 0, isActive: true })
const savingModelEdit = ref(false)

// Delify sync state
const syncingDelify = ref(false)
const delifyUsage = ref<{ windowCostUsd: number | null; windowRequests: number | null; allowedModels: string[] | null } | null>(null)

// ── Bulk selection for providers ──────────────────────────────────────
const selectedProviderIds = ref<Set<number>>(new Set())
const deletingBulkProviders = ref(false)

function toggleSelectProvider(id: number) {
  if (selectedProviderIds.value.has(id)) selectedProviderIds.value.delete(id)
  else selectedProviderIds.value.add(id)
}

function selectAllProviders() {
  if (selectedProviderIds.value.size === providers.value.length) {
    selectedProviderIds.value.clear()
  } else {
    selectedProviderIds.value = new Set(providers.value.map(p => p.id))
  }
}

async function bulkDeleteProviders() {
  const ids = Array.from(selectedProviderIds.value)
  if (ids.length === 0) return
  if (!await confirm({
    title: 'Xoá nhiều nhà cung cấp',
    message: `Bạn có chắc muốn xoá ${ids.length} nhà cung cấp đã chọn? Tất cả model thuộc các nhà cung cấp này cũng sẽ bị xoá.`,
    danger: true,
    confirmLabel: `Xoá ${ids.length} NCC`,
  })) return

  deletingBulkProviders.value = true
  try {
    const res = await $fetch<{ ok: boolean; deleted: number }>('/api/admin/ai/providers/bulk-delete', {
      method: 'POST',
      body: { ids },
    })
    toast.success(`Đã xoá ${res.deleted} nhà cung cấp.`)
    selectedProviderIds.value.clear()
    await loadProviders()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể xoá nhà cung cấp.'))
  } finally {
    deletingBulkProviders.value = false
  }
}

// ── Bulk selection for models ─────────────────────────────────────────
const selectedModelKeys = ref<Set<string>>(new Set())
const deletingBulkModels = ref(false)

function isModelSelected(model: string): boolean {
  return selectedModelKeys.value.has(model)
}

function toggleSelectModel(model: string) {
  if (selectedModelKeys.value.has(model)) selectedModelKeys.value.delete(model)
  else selectedModelKeys.value.add(model)
}

function isAllModelsSelectedForProvider(providerName: string): boolean {
  const models = modelsForProvider(providerName)
  if (models.length === 0) return false
  return models.every(m => selectedModelKeys.value.has(m.model))
}

function toggleSelectAllModelsForProvider(providerName: string) {
  const models = modelsForProvider(providerName)
  const allSelected = isAllModelsSelectedForProvider(providerName)
  if (allSelected) {
    for (const m of models) selectedModelKeys.value.delete(m.model)
  } else {
    for (const m of models) selectedModelKeys.value.add(m.model)
  }
}

async function bulkDeleteModels() {
  const models = Array.from(selectedModelKeys.value)
  if (models.length === 0) return
  if (!await confirm({
    title: 'Xoá nhiều Model',
    message: `Bạn có chắc muốn xoá ${models.length} model đã chọn?`,
    danger: true,
    confirmLabel: `Xoá ${models.length} model`,
  })) return

  deletingBulkModels.value = true
  try {
    const res = await $fetch<{ ok: boolean; deleted: number }>('/api/admin/ai/pricing/bulk-delete', {
      method: 'POST',
      body: { models },
    })
    toast.success(`Đã xoá ${res.deleted} model.`)
    selectedModelKeys.value.clear()
    await loadProviders()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể xoá models.'))
  } finally {
    deletingBulkModels.value = false
  }
}

async function loadProviders() {
  providersError.value = null
  providersLoading.value = true
  try {
    const [pData, prData] = await Promise.all([
      $fetch<{ providers: ProviderRow[] }>('/api/admin/ai/providers'),
      $fetch<{ pricing: PricingRow[] }>('/api/admin/ai/pricing'),
    ])
    providers.value = pData.providers
    pricingRows.value = prData.pricing
  } catch (err: unknown) {
    providersError.value = errorMessage(err, 'Không thể tải danh sách nhà cung cấp.')
  } finally {
    providersLoading.value = false
  }
}

async function loadPricing() {
  try {
    const data = await $fetch<{ pricing: PricingRow[] }>('/api/admin/ai/pricing')
    pricingRows.value = data.pricing
  } catch { /* optional */ }
}

function openProviderEdit(p: ProviderRow) {
  editingProvider.value = p
  providerForm.value = { label: p.label, baseUrl: p.baseUrl ?? '', isActive: p.isActive, apiKey: '' }
  testResult.value = null
}

async function saveProvider() {
  if (!editingProvider.value) return
  savingProvider.value = true
  try {
    await $fetch(`/api/admin/ai/providers/${editingProvider.value.id}`, {
      method: 'PUT',
      body: {
        label: providerForm.value.label,
        baseUrl: providerForm.value.baseUrl || null,
        isActive: providerForm.value.isActive,
        apiKey: providerForm.value.apiKey || null,
      },
    })
    toast.success('Đã lưu cấu hình nhà cung cấp.')
    editingProvider.value = null
    await loadProviders()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể lưu nhà cung cấp.'))
  } finally {
    savingProvider.value = false
  }
}

async function testProvider(id: number) {
  testingProvider.value = id
  testResult.value = null
  try {
    const result = await $fetch<{ ok: boolean; model?: string; error?: string }>(`/api/admin/ai/providers/${id}/test`, {
      method: 'POST',
    })
    if (result.ok) {
      testResult.value = result.model ? `Kết nối thành công (model: ${result.model})` : 'Kết nối thành công.'
    } else {
      testResult.value = `Thất bại: ${result.error ?? 'lỗi không rõ'}`
    }
  } catch (err: unknown) {
    testResult.value = `Thất bại: ${errorMessage(err, 'lỗi kết nối')}`
  } finally {
    testingProvider.value = null
  }
}

function openCreateProvider() {
  showCreateForm.value = true
  newProviderForm.value = { provider: 'delify', label: 'Delify Router', baseUrl: 'https://router.delify.vn/v1', isActive: true, apiKey: '' }
  newProviderError.value = ''
}

function onNewProviderPresetChange() {
  const preset = PROVIDER_PRESETS.find(p => p.value === newProviderForm.value.provider)
  if (preset) {
    newProviderForm.value.label = preset.label
    newProviderForm.value.baseUrl = preset.baseUrl
  }
}

async function createProvider() {
  if (!newProviderForm.value.label.trim()) {
    newProviderError.value = 'Nhãn hiển thị là bắt buộc.'
    return
  }
  savingNewProvider.value = true
  newProviderError.value = ''
  try {
    await $fetch('/api/admin/ai/providers', {
      method: 'POST',
      body: {
        provider: newProviderForm.value.provider,
        label: newProviderForm.value.label,
        baseUrl: newProviderForm.value.baseUrl || null,
        isActive: newProviderForm.value.isActive,
        apiKey: newProviderForm.value.apiKey || null,
      },
    })
    toast.success('Đã thêm nhà cung cấp mới.')
    showCreateForm.value = false
    await loadProviders()
  } catch (err: unknown) {
    newProviderError.value = errorMessage(err, 'Không thể thêm nhà cung cấp.')
  } finally {
    savingNewProvider.value = false
  }
}

async function deleteProvider(p: ProviderRow) {
  if (!await confirm({ title: 'Xoá nhà cung cấp', message: `Xoá "${p.label}"? Dịch vụ đang dùng nhà cung cấp này sẽ cần gán lại.`, danger: true, confirmLabel: 'Xoá' })) return
  deletingProviderId.value = p.id
  try {
    await $fetch(`/api/admin/ai/providers/${p.id}`, { method: 'DELETE' })
    toast.success('Đã xoá nhà cung cấp.')
    await loadProviders()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể xoá nhà cung cấp.'))
  } finally {
    deletingProviderId.value = null
  }
}

// ── Model actions ─────────────────────────────────────────────────────

// Toggle model active status (optimistic update like 9Router)
async function toggleModelActive(m: PricingRow) {
  const original = m.isActive
  m.isActive = !original
  try {
    await $fetch(`/api/admin/ai/pricing/${encodeURIComponent(m.model)}`, {
      method: 'PUT',
      body: { isActive: m.isActive },
    })
    toast.success(`${m.model}: ${m.isActive ? 'Đã bật' : 'Đã tắt'}`)
  } catch (err: unknown) {
    m.isActive = original
    toast.error(errorMessage(err, 'Không thể đổi trạng thái model.'))
  }
}

function openAddModel(providerName: string) {
  targetProviderForModel.value = providerName
  newModelForm.value = { model: '', label: '', promptCostPerMillion: 1.0, completionCostPerMillion: 4.0, isActive: true }
  newModelError.value = ''
  showAddModelModal.value = true
}

async function addModelToProvider() {
  if (!newModelForm.value.model.trim()) {
    newModelError.value = 'Mã model là bắt buộc (ví dụ: glm-5.3, flash).'
    return
  }
  savingNewModel.value = true
  newModelError.value = ''
  try {
    await $fetch('/api/admin/ai/pricing', {
      method: 'POST',
      body: {
        model: newModelForm.value.model.trim(),
        provider: targetProviderForModel.value,
        label: newModelForm.value.label.trim() || null,
        isActive: newModelForm.value.isActive,
        promptCostPerMillion: newModelForm.value.promptCostPerMillion,
        completionCostPerMillion: newModelForm.value.completionCostPerMillion,
      },
    })
    toast.success(`Đã thêm model "${newModelForm.value.model}" cho ${targetProviderForModel.value}.`)
    showAddModelModal.value = false
    await loadProviders()
  } catch (err: unknown) {
    newModelError.value = errorMessage(err, 'Không thể thêm model.')
  } finally {
    savingNewModel.value = false
  }
}

function openEditModel(m: PricingRow) {
  editingModel.value = m
  editModelForm.value = {
    label: m.label ?? '',
    promptCostPerMillion: m.promptCostPerMillion,
    completionCostPerMillion: m.completionCostPerMillion,
    isActive: m.isActive,
  }
}

async function saveEditModel() {
  if (!editingModel.value) return
  savingModelEdit.value = true
  try {
    await $fetch(`/api/admin/ai/pricing/${encodeURIComponent(editingModel.value.model)}`, {
      method: 'PUT',
      body: {
        label: editModelForm.value.label.trim() || null,
        promptCostPerMillion: editModelForm.value.promptCostPerMillion,
        completionCostPerMillion: editModelForm.value.completionCostPerMillion,
        isActive: editModelForm.value.isActive,
      },
    })
    toast.success(`Đã lưu cấu hình model "${editingModel.value.model}".`)
    editingModel.value = null
    await loadProviders()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể lưu model.'))
  } finally {
    savingModelEdit.value = false
  }
}

async function deleteModel(m: PricingRow) {
  if (!await confirm({ title: 'Xoá Model', message: `Xoá model "${m.model}" khỏi ${m.provider}?`, danger: true, confirmLabel: 'Xoá' })) return
  try {
    await $fetch(`/api/admin/ai/pricing/${encodeURIComponent(m.model)}`, { method: 'DELETE' })
    toast.success(`Đã xoá model "${m.model}".`)
    await loadProviders()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể xoá model.'))
  }
}

// ── Test call model directly (9Router style) ──────────────────────────
const testingModelKey = ref<string | null>(null)
const modelTestModal = ref<{
  model: string
  provider: string
  reply: string
  durationMs: number
  usage: { promptTokens: number; completionTokens: number; totalTokens: number }
  costVnd: number
  error: string | null
} | null>(null)

async function testCallModel(provider: string, model: string) {
  testingModelKey.value = model
  try {
    const result = await $fetch<{
      ok: boolean
      model?: string
      reply?: string
      durationMs?: number
      usage?: { promptTokens: number; completionTokens: number; totalTokens: number }
      costVnd?: number
      error?: string
    }>('/api/admin/ai/test-call', {
      method: 'POST',
      body: {
        provider,
        model,
        serviceKey: 'test_call',
        message: 'Xin chào! Hãy phản hồi ngắn gọn 1 câu để kiểm tra kết nối.',
        maxTokens: 100,
      },
    })
    logs.value = []
    void loadUsage()
    if (result.ok) {
      modelTestModal.value = {
        model,
        provider,
        reply: result.reply ?? '',
        durationMs: result.durationMs ?? 0,
        usage: result.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        costVnd: result.costVnd ?? 0,
        error: null,
      }
    } else {
      modelTestModal.value = {
        model,
        provider,
        reply: '',
        durationMs: 0,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        costVnd: 0,
        error: result.error ?? 'Lỗi không xác định từ model',
      }
    }
  } catch (err: unknown) {
    modelTestModal.value = {
      model,
      provider,
      reply: '',
      durationMs: 0,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      costVnd: 0,
      error: errorMessage(err, 'Lỗi kết nối tới API'),
    }
  } finally {
    testingModelKey.value = null
  }
}

async function syncDelifyPricing() {
  syncingDelify.value = true
  try {
    const result = await $fetch<{
      ok: boolean
      upserted: number
      syncedLogs: number
      totalFromApi: number
      delifyUsage: { windowCostUsd: number | null; windowRequests: number | null; allowedModels: string[] | null } | null
    }>('/api/admin/ai/delify/sync', {
      method: 'POST',
    })
    if (result.delifyUsage) {
      delifyUsage.value = result.delifyUsage
    }
    const logMsg = result.syncedLogs > 0 ? ` và ${result.syncedLogs} cuộc gọi` : ''
    toast.success(`Đã đồng bộ ${result.upserted} model${logMsg} từ Delify Router.`)
    await loadProviders()
    void loadDelifyStatus()
    logs.value = []
    void loadUsage()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể đồng bộ từ Delify.'))
  } finally {
    syncingDelify.value = false
  }
}


function estimatedCostVnd(promptPerM: number, compPerM: number): string {
  const usd = (1000 * promptPerM + 500 * compPerM) / 1_000_000
  const vnd = usd * 25500
  return formatVnd(vnd)
}

// ─────────────────────────────────────────────────────────────────────────
// Services Tab
// ─────────────────────────────────────────────────────────────────────────
interface ServiceRow {
  id: number
  serviceKey: string
  serviceName: string
  provider: string
  model: string | null
  systemPrompt: string | null
  temperature: string
  maxTokens: number
  isActive: boolean
  updatedAt: string | null
}

const servicesError = ref(null as string | null)
const servicesLoading = ref(false)
const services = ref<ServiceRow[]>([])
const editingService = ref<ServiceRow | null>(null)
const serviceForm = ref({ model: '', systemPrompt: '', temperature: '0.30', maxTokens: 4096, isActive: false, provider: '' })
const savingService = ref(false)
const testingService = ref(false)
const serviceTestResult = ref<string | null>(null)

const TEMPLATE_HINTS: Record<string, string[]> = {
  chatbot: ['{{question}}', '{{references}}', '{{fallback_message}}'],
  translation_article: ['{{source_text}}', '{{target_language}}', '{{source_language}}'],
  translation_ui: ['{{source_text}}', '{{target_language}}'],
  editorial_assistant: ['{{article_title}}', '{{article_content}}'],
  moderation: ['{{content}}', '{{author}}'],
}

// Active models for currently selected provider in the service form
const activeModelsForSelectedProvider = computed(() => {
  return pricingRows.value.filter(m => m.provider === serviceForm.value.provider && m.isActive)
})

async function loadServices() {
  servicesError.value = null
  servicesLoading.value = true
  try {
    const [sData, prData] = await Promise.all([
      $fetch<{ services: ServiceRow[] }>('/api/admin/ai/services'),
      $fetch<{ pricing: PricingRow[] }>('/api/admin/ai/pricing'),
    ])
    services.value = sData.services
    pricingRows.value = prData.pricing
  } catch (err: unknown) {
    servicesError.value = errorMessage(err, 'Không thể tải danh sách dịch vụ.')
  } finally {
    servicesLoading.value = false
  }
}

function openServiceEdit(s: ServiceRow) {
  editingService.value = s
  serviceForm.value = {
    model: s.model ?? '',
    systemPrompt: s.systemPrompt ?? '',
    temperature: s.temperature,
    maxTokens: s.maxTokens,
    isActive: s.isActive,
    provider: s.provider,
  }
  serviceTestResult.value = null
}

async function saveService() {
  if (!editingService.value) return
  savingService.value = true
  try {
    await $fetch(`/api/admin/ai/services/${editingService.value.id}`, {
      method: 'PUT',
      body: {
        model: serviceForm.value.model || null,
        systemPrompt: serviceForm.value.systemPrompt || null,
        provider: serviceForm.value.provider,
        temperature: serviceForm.value.temperature,
        maxTokens: serviceForm.value.maxTokens,
        isActive: serviceForm.value.isActive,
      },
    })
    toast.success('Đã lưu cấu hình dịch vụ.')
    editingService.value = null
    await loadServices()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể lưu dịch vụ.'))
  } finally {
    savingService.value = false
  }
}

async function testService() {
  if (!editingService.value) return
  if (!serviceForm.value.model.trim()) {
    serviceTestResult.value = 'Thất bại: Vui lòng chọn hoặc nhập mã model cần kiểm tra.'
    return
  }
  testingService.value = true
  serviceTestResult.value = null
  try {
    const result = await $fetch<{
      ok: boolean
      model?: string
      reply?: string
      durationMs?: number
      usage?: { promptTokens: number; completionTokens: number; totalTokens: number }
      costVnd?: number
      error?: string
    }>('/api/admin/ai/test-call', {
      method: 'POST',
      body: {
        provider: serviceForm.value.provider,
        model: serviceForm.value.model.trim(),
        serviceKey: editingService.value.serviceKey,
        systemPrompt: serviceForm.value.systemPrompt || null,
        message: 'Xin chào! Hãy giới thiệu bạn là ai trong 1 câu ngắn.',
        temperature: Number(serviceForm.value.temperature) || 0.3,
        maxTokens: 150,
      },
    })
    logs.value = []
    void loadUsage()
    if (result.ok) {
      serviceTestResult.value = `Thành công (${result.model} — ${result.durationMs}ms):\n"${result.reply}"\n[${result.usage?.totalTokens ?? 0} tokens ~ ${formatVnd(result.costVnd ?? 0)}]`
    } else {
      serviceTestResult.value = `Thất bại: ${result.error ?? 'Lỗi không rõ từ model'}`
    }
  } catch (err: unknown) {
    serviceTestResult.value = `Thất bại: ${errorMessage(err, 'Lỗi kết nối tới API')}`
  } finally {
    testingService.value = false
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Logs Tab
// ─────────────────────────────────────────────────────────────────────────
interface LogRow {
  id: number
  serviceKey: string
  provider: string
  model: string | null
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costUsd: string
  costVnd: string
  executionMs: number
  userId: number | null
  success: boolean
  errorMessage: string | null
  createdAt: string | null
}

const logsError = ref(null as string | null)
const logsLoading = ref(false)
const logs = ref<LogRow[]>([])
const logsPagination = ref({ page: 1, perPage: 20, total: 0, totalPages: 0 })
const logsFilters = ref({ serviceKey: '', provider: '', startDate: '', endDate: '', success: '' })
const expandedRows = ref<Set<number>>(new Set())

function toggleRowExpand(id: number) {
  if (expandedRows.value.has(id)) expandedRows.value.delete(id)
  else expandedRows.value.add(id)
}

async function loadLogs() {
  logsError.value = null
  logsLoading.value = true
  try {
    const params: Record<string, string> = { page: String(logsPagination.value.page), perPage: String(logsPagination.value.perPage) }
    if (logsFilters.value.serviceKey) params.serviceKey = logsFilters.value.serviceKey
    if (logsFilters.value.provider) params.provider = logsFilters.value.provider
    if (logsFilters.value.startDate) params.startDate = logsFilters.value.startDate
    if (logsFilters.value.endDate) params.endDate = logsFilters.value.endDate
    if (logsFilters.value.success) params.success = logsFilters.value.success

    const data = await $fetch<{ logs: LogRow[]; pagination: { page: number; perPage: number; total: number; totalPages: number } }>('/api/admin/ai/logs', { params })
    logs.value = data.logs
    logsPagination.value = data.pagination
  } catch (err: unknown) {
    logsError.value = errorMessage(err, 'Không thể tải nhật ký.')
  } finally {
    logsLoading.value = false
  }
}

function applyFilters() {
  logsPagination.value.page = 1
  expandedRows.value = new Set()
  void loadLogs()
}

function goToPage(page: number) {
  logsPagination.value.page = page
  void loadLogs()
}

function formatTime(dateStr: string | null): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })
}
// ── Moderation Tab ────────────────────────────────────────────────────────
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

const RULE_CATEGORY_LABELS: Record<string, string> = {
  hostile_forces: 'Thế lực thù địch / Phản động',
  anti_state: 'Chống phá / Xuyên tạc chính sách',
  defamation: 'Bôi nhọ / Xúc phạm uy tín',
  spam_fraud: 'Spam / Cờ bạc / Lừa đảo',
  profanity: 'Từ ngữ thô tục',
  custom: 'Tùy biến',
}

async function loadModeration() {
  moderationLoading.value = true
  moderationError.value = ''
  try {
    const [rulesData, queueData] = await Promise.all([
      $fetch<{ ok: boolean; rules: ModerationRule[] }>('/api/admin/ai/moderation/rules'),
      $fetch<{ ok: boolean; items: ModerationQueueItem[] }>('/api/admin/ai/moderation/queue', {
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
    await $fetch('/api/admin/ai/moderation/rules', {
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
    await $fetch(`/api/admin/ai/moderation/rules/${rule.id}`, {
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
    await $fetch(`/api/admin/ai/moderation/rules/${rule.id}`, { method: 'DELETE' })
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
    await $fetch(`/api/admin/ai/moderation/queue/${item.id}/resolve`, {
      method: 'POST',
      body: { action },
    })
    toast.success('Đã xử lý đối soát thành công!')
    await loadModeration()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể xử lý đối soát.'))
  }
}

// ── Lazy-load tab data on first switch ───────────────────────────────
watch(activeTab, (tab) => {
  if (tab === 'providers' && providers.value.length === 0 && !providersError.value) void loadProviders()
  if (tab === 'services' && services.value.length === 0 && !servicesError.value) void loadServices()
  if (tab === 'moderation') void loadModeration()
  if (tab === 'logs' && logs.value.length === 0 && !logsError.value) void loadLogs()
})

onMounted(() => {
  void loadUsage()
  void loadDelifyStatus()
})
</script>

<template>
  <div class="flex flex-col gap-5">
    <header class="flex flex-col gap-1">
      <h1 class="m-0 text-[1.3rem] font-extrabold text-[#122815]">AI Panel</h1>
      <p class="m-0 mt-1 text-sm text-[#667768]">Quản lý nhà cung cấp AI, phân bổ model, prompt dịch vụ và theo dõi chi phí tập trung kiểu 9Router.</p>
    </header>

    <!-- Tab navigation -->
    <nav class="flex flex-wrap gap-1 border-b border-[#e2ece3]">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        class="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors cursor-pointer bg-transparent"
        :class="activeTab === tab.key
          ? 'border-[#2c6e33] text-[#2c6e33]'
          : 'border-transparent text-[#667768] hover:text-[#2c6e33]'"
        @click="activeTab = tab.key"
      >
        <i :class="tab.icon" class="text-[0.9rem]"></i>
        {{ tab.label }}
      </button>
    </nav>

    <!-- ─── Dashboard Tab ─────────────────────────────────────────────── -->
    <div v-if="activeTab === 'dashboard'" class="flex flex-col gap-5">
      <div v-if="usageError" class="rounded-lg border border-[#f1b8b5] bg-[#fff4f3] p-3 text-sm text-[#a32924]" role="alert">
        <strong>Lỗi:</strong> {{ usageError }}
        <button type="button" class="font-bold underline text-[#4A6741] ml-2" @click="loadUsage()">Thử lại</button>
      </div>

      <div v-if="usageLoading" class="flex items-center justify-center py-12" role="status" aria-busy="true">
        <span class="sr-only">Đang tải dữ liệu tổng quan</span>
        <div class="flex gap-1.5" aria-hidden="true">
          <span class="w-2.5 h-2.5 rounded-full bg-[#2c6e33] animate-pulse motion-reduce:animate-none"></span>
          <span class="w-2.5 h-2.5 rounded-full bg-[#2c6e33] animate-pulse motion-reduce:animate-none" style="animation-delay: 0.15s"></span>
          <span class="w-2.5 h-2.5 rounded-full bg-[#2c6e33] animate-pulse motion-reduce:animate-none" style="animation-delay: 0.3s"></span>
        </div>
      </div>

      <template v-if="!usageLoading && !usageError">
        <!-- KPI Cards -->
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div class="rounded-xl border border-[#e2ece3] bg-white p-4">
            <p class="m-0 text-xs font-bold text-[#667768] uppercase tracking-wide">Chi phí tháng này</p>
            <p class="m-0 mt-2 text-2xl font-extrabold text-[#122815]">{{ formatVnd(usageSummary?.monthlyCostVnd ?? 0) }}</p>
          </div>
          <div class="rounded-xl border border-[#e2ece3] bg-white p-4">
            <p class="m-0 text-xs font-bold text-[#667768] uppercase tracking-wide">Tổng Tokens</p>
            <p class="m-0 mt-2 text-2xl font-extrabold text-[#122815]">{{ formatNum(usageSummary?.totalTokens ?? 0) }}</p>
            <p class="m-0 mt-1 text-xs text-[#667768]">Input: {{ formatNum(usageSummary?.totalPromptTokens ?? 0) }} / Output: {{ formatNum(usageSummary?.totalCompletionTokens ?? 0) }}</p>
          </div>
          <div class="rounded-xl border border-[#e2ece3] bg-white p-4">
            <p class="m-0 text-xs font-bold text-[#667768] uppercase tracking-wide">Số lượt gọi AI</p>
            <p class="m-0 mt-2 text-2xl font-extrabold text-[#122815]">{{ formatNum(usageSummary?.totalRequests ?? 0) }}</p>
            <p class="m-0 mt-1 text-xs text-[#667768]">Tỉ lệ thành công: {{ (usageSummary?.successRate ?? 100).toFixed(1) }}%</p>
          </div>
          <div class="rounded-xl border border-[#e2ece3] bg-white p-4">
            <p class="m-0 text-xs font-bold text-[#667768] uppercase tracking-wide">Hạn mức ngân sách</p>
            <p class="m-0 mt-2 text-2xl font-extrabold text-[#122815]">
              {{ effectiveBudgetVnd ? formatVnd(effectiveBudgetVnd) : 'Không giới hạn' }}
            </p>
            <div v-if="effectiveBudgetVnd" class="mt-2">
              <div class="h-2 rounded-full bg-[#e2ece3] overflow-hidden">
                <div class="h-full rounded-full transition-all" :class="budgetColor" :style="{ width: Math.min(100, effectiveUsagePercent) + '%' }"></div>
              </div>
              <p class="m-0 mt-1 text-xs text-[#667768]">{{ effectiveUsagePercent.toFixed(1) }}% (đã dùng {{ formatVnd(effectiveUsedVnd) }})</p>
            </div>
          </div>
        </div>

        <!-- Delify Router Live Observability Card (Real-time from Delify API) -->
        <div class="rounded-xl border border-[#c8d6c9] bg-[#f0f7f1] p-4 sm:p-5 flex flex-col gap-4 shadow-sm">
          <!-- Card Header with Period Selector -->
          <div class="flex flex-wrap items-center justify-between gap-3 border-b border-[#c8d6c9] pb-3">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-[#2c6e33] text-white flex items-center justify-center font-bold text-lg shadow-sm">
                <i class="fa-solid fa-cloud-bolt" aria-hidden="true"></i>
              </div>
              <div>
                <div class="flex items-center gap-2">
                  <h2 class="m-0 text-base font-extrabold text-[#122815]">Trạng thái Delify Router (Thời gian thực từ API)</h2>
                  <span
                    class="px-2 py-0.5 rounded-full text-xs font-bold"
                    :class="delifyStatus?.ok ? 'bg-green-100 text-green-800 border border-green-300' : 'bg-yellow-100 text-yellow-800 border border-yellow-300'"
                  >
                    {{ delifyStatus?.ok ? '● Đã kết nối' : 'Chưa kết nối' }}
                  </span>
                </div>
                <p class="m-0 mt-0.5 text-xs text-[#667768] flex items-center gap-2 flex-wrap">
                  <span v-if="delifyStatus?.keyInfo">Key: <strong class="text-[#122815]">{{ delifyStatus.keyInfo.name }}</strong> (Nhóm: {{ delifyStatus.keyInfo.groupName }})</span>
                  <span>•</span>
                  <span>Cập nhật trực tiếp từ <code class="text-[#2c6e33]">router.delify.vn</code></span>
                </p>
              </div>
            </div>

            <!-- Period Filter Tabs & Refresh Button -->
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="text-xs font-semibold text-[#667768] mr-1 hidden sm:inline">Kỳ lọc:</span>
              <button
                v-for="p in ([{ key: '1h', label: '1 Giờ' }, { key: '24h', label: '24 Giờ' }, { key: '7d', label: '7 Ngày' }, { key: '30d', label: '30 Ngày' }, { key: 'all', label: 'Tất cả' }] as const)"
                :key="p.key"
                type="button"
                class="px-2.5 py-1 rounded-md text-xs font-bold transition-all cursor-pointer"
                :class="delifyPeriod === p.key
                  ? 'bg-[#2c6e33] text-white shadow-xs'
                  : 'bg-white text-[#667768] border border-[#c8d6c9] hover:bg-[#e4ece4]'"
                :disabled="delifyStatusLoading"
                @click="loadDelifyStatus(p.key)"
              >
                {{ p.label }}
              </button>

              <button
                type="button"
                class="px-2.5 py-1 rounded-md bg-white border border-[#c8d6c9] text-xs font-bold text-[#2c6e33] hover:bg-[#e4ece4] ml-1 flex items-center gap-1"
                :disabled="delifyStatusLoading"
                title="Làm mới dữ liệu từ Delify Router"
                @click="loadDelifyStatus()"
              >
                <i class="fa-solid fa-rotate text-[0.7rem]" :class="delifyStatusLoading ? 'animate-spin' : ''" aria-hidden="true"></i>
                <span class="hidden sm:inline">Làm mới</span>
              </button>
            </div>
          </div>

          <div v-if="delifyStatusLoading" class="py-6 text-center text-xs text-[#667768]" role="status" aria-busy="true">
            <span class="inline-block w-4 h-4 rounded-full border-2 border-[#2c6e33] border-t-transparent animate-spin mr-2"></span>
            Đang tải dữ liệu thời gian thực từ router.delify.vn...
          </div>

          <div v-else-if="delifyStatusError" class="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700" role="alert">
            <i class="fa-solid fa-triangle-exclamation mr-1" aria-hidden="true"></i>
            {{ delifyStatusError }}
          </div>

          <template v-else-if="delifyStatus?.ok && delifyStatus.keyInfo">
            <!-- 4 Financial Metric Cards -->
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <!-- 1. Ngân sách được cấp -->
              <div class="rounded-xl bg-white p-3.5 border border-[#e2ece3] shadow-xs">
                <p class="m-0 text-xs font-bold text-[#667768] uppercase">Ngân sách được cấp</p>
                <p class="m-0 mt-1 text-xl font-extrabold text-[#122815]">
                  {{ delifyStatus.keyInfo.budgetUsd != null ? '$' + delifyStatus.keyInfo.budgetUsd.toFixed(2) : 'Không giới hạn' }}
                </p>
                <p class="m-0 mt-0.5 text-xs text-[#667768]">
                  ~{{ formatVnd((delifyStatus.keyInfo.budgetUsd ?? 0) * 25500) }}
                </p>
              </div>

              <!-- 2. Số tiền đã dùng -->
              <div class="rounded-xl bg-white p-3.5 border border-[#e2ece3] shadow-xs">
                <p class="m-0 text-xs font-bold text-[#667768] uppercase">Tiền hiện tại đã dùng</p>
                <p class="m-0 mt-1 text-xl font-extrabold text-[#d12420]">
                  {{ formatVnd(delifyStatus.keyInfo.usedCostVnd ?? ((delifyStatus.keyInfo.usedCostUsd ?? 0) * 25500)) }}
                </p>
                <p class="m-0 mt-0.5 text-xs text-[#667768]">
                  ~${{ (delifyStatus.keyInfo.usedCostUsd ?? 0).toFixed(4) }} ({{ delifyStatus.keyInfo.totalRequests }} cuộc gọi)
                </p>
              </div>

              <!-- 3. SỐ TIỀN CÒN LẠI (Remaining Balance) -->
              <div class="rounded-xl bg-white p-3.5 border border-[#c8d6c9] bg-gradient-to-br from-white to-[#f0f7f1] shadow-xs ring-1 ring-[#2c6e33]/20">
                <div class="flex items-center justify-between">
                  <p class="m-0 text-xs font-bold text-[#2c6e33] uppercase tracking-wide">Số tiền CÒN LẠI</p>
                  <i class="fa-solid fa-wallet text-[#2c6e33] text-xs" aria-hidden="true"></i>
                </div>
                <p class="m-0 mt-1 text-2xl font-extrabold text-[#2c6e33]">
                  {{ delifyStatus.keyInfo.remainingBudgetVnd != null ? formatVnd(delifyStatus.keyInfo.remainingBudgetVnd) : (delifyStatus.keyInfo.remainingBudgetUsd != null ? '$' + delifyStatus.keyInfo.remainingBudgetUsd.toFixed(4) : '—') }}
                </p>
                <p class="m-0 mt-0.5 text-xs font-bold text-[#122815]">
                  {{ delifyStatus.keyInfo.remainingBudgetUsd != null ? '$' + delifyStatus.keyInfo.remainingBudgetUsd.toFixed(4) : '—' }}
                </p>
              </div>

              <!-- 4. Chi phí trong kỳ đã lọc -->
              <div class="rounded-xl bg-white p-3.5 border border-[#e2ece3] shadow-xs">
                <div class="flex items-center justify-between">
                  <p class="m-0 text-xs font-bold text-[#667768] uppercase">Trong kỳ ({{ delifyPeriod }})</p>
                  <span class="text-[0.65rem] px-1.5 py-0.5 bg-[#e4f0e2] text-[#2c6e33] font-bold rounded">API Receipts</span>
                </div>
                <p class="m-0 mt-1 text-xl font-extrabold text-[#122815]">
                  ${{ (delifyStatus.periodSummary?.totals?.cost ?? 0).toFixed(4) }}
                </p>
                <p class="m-0 mt-0.5 text-xs text-[#667768]">
                  {{ delifyStatus.periodSummary?.totals?.requests ?? 0 }} requests • {{ formatNum(delifyStatus.periodSummary?.totals?.input ?? 0) }} in / {{ formatNum(delifyStatus.periodSummary?.totals?.output ?? 0) }} out
                </p>
              </div>
            </div>

          </template>
        </div>
        <!-- Charts -->
        <div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <!-- Daily cost bar chart -->
          <div class="rounded-xl border border-[#e2ece3] bg-white p-4">
            <h2 class="m-0 mb-4 text-sm font-bold text-[#122815]">Chi phí theo ngày (30 ngày gần nhất)</h2>
            <div v-if="dailyData.length === 0" class="py-8 text-center text-sm text-[#667768]">Chưa có dữ liệu.</div>
            <div v-else class="flex items-end gap-1 h-[140px] border-b border-[#e2ece3] pb-1">
              <div
                v-for="row in dailyData"
                :key="row.day"
                class="flex-1 min-w-[3px] rounded-t-sm bg-[#2c6e33] hover:bg-[#4A6741] transition-colors"
                :style="{ height: chartBarHeight(row.costVnd) + 'px' }"
                :title="`${row.day}: ${formatVnd(row.costVnd)}`"
              ></div>
            </div>
          </div>

          <!-- Cost by service donut -->
          <div class="rounded-xl border border-[#e2ece3] bg-white p-4">
            <h2 class="m-0 mb-4 text-sm font-bold text-[#122815]">Chi phí theo dịch vụ</h2>
            <div v-if="byService.length === 0" class="py-8 text-center text-sm text-[#667768]">Chưa có dữ liệu.</div>
            <div v-else class="flex items-center gap-6">
              <svg viewBox="0 0 100 100" class="w-[140px] h-[140px] -rotate-90 shrink-0">
                <circle cx="50" cy="50" r="40" fill="none" stroke="#e2ece3" stroke-width="14" />
                <circle
                  v-for="(seg, i) in donutSegments"
                  :key="i"
                  cx="50"
                  cy="50"
                  r="40"
                  fill="none"
                  :stroke="seg.color"
                  stroke-width="14"
                  :stroke-dasharray="seg.dasharray"
                  :stroke-dashoffset="seg.dashoffset"
                />
              </svg>
              <ul class="flex-1 flex flex-col gap-2 m-0 p-0 list-none">
                <li v-for="(seg, i) in donutSegments" :key="i" class="flex items-center gap-2 text-xs">
                  <span class="w-3 h-3 rounded-sm shrink-0" :style="{ background: seg.color }"></span>
                  <span class="font-semibold text-[#122815]">{{ seg.label }}</span>
                  <span class="ml-auto text-[#667768]">{{ (seg.fraction * 100).toFixed(1) }}%</span>
                  <span class="text-[#667768]">{{ formatVnd(seg.costVnd) }}</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- ─── Providers & Models Tab (9Router style) ──────────────────────── -->
    <div v-if="activeTab === 'providers'" class="flex flex-col gap-5">
      <div v-if="providersError" class="rounded-lg border border-[#f1b8b5] bg-[#fff4f3] p-3 text-sm text-[#a32924]" role="alert">
        <strong>Lỗi:</strong> {{ providersError }}
        <button type="button" class="font-bold underline text-[#4A6741] ml-2" @click="loadProviders()">Thử lại</button>
      </div>

      <div v-if="providersLoading" class="flex items-center justify-center py-12" role="status" aria-busy="true">
        <span class="sr-only">Đang tải danh sách nhà cung cấp</span>
        <div class="flex gap-1.5" aria-hidden="true">
          <span class="w-2.5 h-2.5 rounded-full bg-[#2c6e33] animate-pulse motion-reduce:animate-none"></span>
          <span class="w-2.5 h-2.5 rounded-full bg-[#2c6e33] animate-pulse motion-reduce:animate-none" style="animation-delay: 0.15s"></span>
          <span class="w-2.5 h-2.5 rounded-full bg-[#2c6e33] animate-pulse motion-reduce:animate-none" style="animation-delay: 0.3s"></span>
        </div>
      </div>

      <template v-if="!providersLoading && !providersError">
        <!-- Header action bar -->
        <div class="flex flex-wrap items-center justify-between gap-3">
          <p class="m-0 text-sm text-[#667768]">
            Quản lý API Key, kết nối và cấu hình từng model được phép dùng cho mỗi Nhà cung cấp.
          </p>
          <button type="button" class="px-4 py-2 rounded-lg bg-[#2c6e33] text-white text-sm font-semibold hover:bg-[#1e4620]" @click="openCreateProvider()">
            <i class="fa-solid fa-plus mr-1.5" aria-hidden="true"></i> Thêm nhà cung cấp
          </button>
        </div>

        <!-- Provider Bulk Action Bar -->
        <div v-if="selectedProviderIds.size > 0" class="rounded-xl border border-red-200 bg-red-50/80 p-3.5 flex flex-wrap items-center justify-between gap-3 shadow-sm">
          <div class="flex items-center gap-2">
            <i class="fa-solid fa-circle-check text-[#d12420]" aria-hidden="true"></i>
            <span class="text-xs font-bold text-[#a32924]">
              Đã chọn <strong>{{ selectedProviderIds.size }}</strong> nhà cung cấp
            </span>
          </div>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="px-3 py-1.5 rounded-lg border border-[#c8d6c9] bg-white text-xs font-semibold text-[#667768] hover:bg-[#f0f4f0]"
              @click="selectedProviderIds.clear()"
            >
              Bỏ chọn
            </button>
            <button
              type="button"
              class="px-3.5 py-1.5 rounded-lg bg-[#d12420] text-white text-xs font-bold hover:bg-[#b01e1a] shadow-sm transition-colors"
              :disabled="deletingBulkProviders"
              @click="bulkDeleteProviders()"
            >
              <i class="fa-solid fa-trash mr-1.5" aria-hidden="true"></i>
              {{ deletingBulkProviders ? 'Đang xoá...' : `Xoá ${selectedProviderIds.size} nhà cung cấp đã chọn` }}
            </button>
          </div>
        </div>

        <!-- 9Router Provider Cards -->
        <div class="flex flex-col gap-4">
          <div
            v-for="p in providers"
            :key="p.id"
            class="rounded-xl border border-[#e2ece3] bg-white overflow-hidden shadow-sm transition-all"
          >
            <!-- Provider Card Header -->
            <div class="p-4 sm:p-5 flex flex-col gap-3 border-b border-[#e2ece3] bg-[#fafcfa]">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="flex items-center gap-3">
                  <!-- Checkbox to select provider -->
                  <label class="flex items-center cursor-pointer p-0.5" title="Chọn nhà cung cấp này để xoá">
                    <input
                      type="checkbox"
                      class="w-4 h-4 accent-[#2c6e33] rounded cursor-pointer"
                      :checked="selectedProviderIds.has(p.id)"
                      @change="toggleSelectProvider(p.id)"
                    />
                  </label>
                  <!-- Provider Icon -->
                  <div class="w-10 h-10 rounded-xl bg-[#e4f0e2] text-[#2c6e33] flex items-center justify-center text-lg font-bold">
                    <i v-if="p.provider === 'delify'" class="fa-solid fa-bolt" aria-hidden="true"></i>
                    <i v-else-if="p.provider === 'google'" class="fa-brands fa-google" aria-hidden="true"></i>
                    <i v-else-if="p.provider === 'openai'" class="fa-solid fa-brain" aria-hidden="true"></i>
                    <i v-else-if="p.provider === 'anthropic'" class="fa-solid fa-robot" aria-hidden="true"></i>
                    <i v-else class="fa-solid fa-server" aria-hidden="true"></i>
                  </div>
                  <div>
                    <div class="flex items-center gap-2">
                      <h2 class="m-0 text-base font-extrabold text-[#122815]">{{ p.label }}</h2>
                      <span class="text-xs font-mono text-[#667768] bg-[#f0f4f0] px-2 py-0.5 rounded">({{ p.provider }})</span>
                      <span
                        class="px-2 py-0.5 rounded-full text-xs font-semibold"
                        :class="p.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'"
                      >
                        {{ p.isActive ? 'Hoạt động' : 'Tắt' }}
                      </span>
                    </div>
                    <p class="m-0 mt-0.5 text-xs text-[#667768] flex items-center gap-2 flex-wrap">
                      <span>Base URL: <code class="text-[#2c6e33]">{{ p.baseUrl ?? 'Chưa cấu hình' }}</code></span>
                      <span>•</span>
                      <span>API Key: <code>{{ p.apiKeyLastFour ? '••••' + p.apiKeyLastFour : 'Chưa nhập' }}</code></span>
                    </p>
                  </div>
                </div>

                <!-- Provider Actions -->
                <div class="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    class="px-3 py-1.5 rounded-lg border border-[#c8d6c9] bg-white text-xs font-semibold text-[#122815] hover:bg-[#f0f7f1]"
                    :disabled="testingProvider === p.id"
                    @click="testProvider(p.id)"
                  >
                    <i class="fa-solid fa-vial mr-1" aria-hidden="true"></i>
                    {{ testingProvider === p.id ? 'Đang test...' : 'Test kết nối' }}
                  </button>
                  <button
                    type="button"
                    class="px-3 py-1.5 rounded-lg border border-[#c8d6c9] bg-white text-xs font-semibold text-[#122815] hover:bg-[#f0f7f1]"
                    @click="openProviderEdit(p)"
                  >
                    <i class="fa-solid fa-gear mr-1" aria-hidden="true"></i> Cài đặt
                  </button>
                  <button
                    type="button"
                    class="px-2.5 py-1.5 rounded-lg border border-transparent text-xs font-semibold text-[#d12420] hover:bg-red-50"
                    :disabled="deletingProviderId === p.id"
                    @click="deleteProvider(p)"
                  >
                    <i class="fa-solid fa-trash" aria-hidden="true"></i>
                  </button>
                  <button
                    type="button"
                    class="p-1.5 rounded-lg text-[#667768] hover:bg-[#e4ece4]"
                    :title="isProviderPanelOpen(p.provider) ? 'Thu gọn models' : 'Mở rộng models'"
                    @click="toggleProviderPanel(p.provider)"
                  >
                    <i class="fa-solid transition-transform duration-200" :class="isProviderPanelOpen(p.provider) ? 'fa-chevron-up' : 'fa-chevron-down'" aria-hidden="true"></i>
                  </button>
                </div>
              </div>

              <!-- Test result banner -->
              <div v-if="testResult && editingProvider?.id === p.id" class="rounded-lg p-2.5 text-xs font-medium" :class="testResult.includes('Thất bại') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'" role="status">
                {{ testResult }}
              </div>
            </div>

            <!-- Provider Models Section (Expandable 9Router style) -->
            <div v-show="isProviderPanelOpen(p.provider)" class="p-4 sm:p-5 flex flex-col gap-3">
              <!-- Models Sub-Header -->
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="flex items-center gap-2">
                  <span class="text-xs font-bold text-[#122815] uppercase tracking-wide">
                    Danh sách Models của {{ p.label }}
                  </span>
                  <span class="text-xs text-[#667768]">
                    ({{ modelsForProvider(p.provider).length }} models, {{ modelsForProvider(p.provider).filter(m => m.isActive).length }} đang bật)
                  </span>
                </div>

                <div class="flex items-center gap-2">
                  <!-- Delify Router Instant Sync Button -->
                  <button
                    v-if="p.provider === 'delify'"
                    type="button"
                    class="px-3 py-1.5 rounded-lg border border-[#2c6e33] bg-[#f0f7f1] text-xs font-bold text-[#2c6e33] hover:bg-[#e4f0e2]"
                    :disabled="syncingDelify"
                    @click="syncDelifyPricing()"
                  >
                    <i class="fa-solid fa-rotate mr-1" aria-hidden="true"></i>
                    {{ syncingDelify ? 'Đang đồng bộ...' : '⚡ Tải model & giá từ Delify API' }}
                  </button>

                  <!-- Add Model to this provider -->
                  <button
                    type="button"
                    class="px-3 py-1.5 rounded-lg border border-[#c8d6c9] bg-white text-xs font-semibold text-[#122815] hover:bg-[#f0f7f1]"
                    @click="openAddModel(p.provider)"
                  >
                    <i class="fa-solid fa-plus mr-1" aria-hidden="true"></i> Thêm Model
                  </button>
                </div>
              </div>
              <!-- Model Bulk Action Bar -->
              <div
                v-if="modelsForProvider(p.provider).some(m => selectedModelKeys.has(m.model))"
                class="rounded-lg border border-red-200 bg-red-50/90 p-2.5 flex flex-wrap items-center justify-between gap-2"
              >
                <span class="text-xs font-bold text-[#a32924]">
                  Đã chọn <strong>{{ modelsForProvider(p.provider).filter(m => selectedModelKeys.has(m.model)).length }}</strong> model của {{ p.label }}
                </span>
                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    class="px-2.5 py-1 rounded border border-[#c8d6c9] bg-white text-xs font-semibold text-[#667768] hover:bg-[#f0f4f0]"
                    @click="modelsForProvider(p.provider).forEach(m => selectedModelKeys.delete(m.model))"
                  >
                    Bỏ chọn
                  </button>
                  <button
                    type="button"
                    class="px-3 py-1 rounded bg-[#d12420] text-white text-xs font-bold hover:bg-[#b01e1a] shadow-sm transition-colors"
                    :disabled="deletingBulkModels"
                    @click="bulkDeleteModels()"
                  >
                    <i class="fa-solid fa-trash mr-1" aria-hidden="true"></i>
                    {{ deletingBulkModels ? 'Đang xoá...' : `Xoá ${modelsForProvider(p.provider).filter(m => selectedModelKeys.has(m.model)).length} model đã chọn` }}
                  </button>
                </div>
              </div>

              <!-- Models Table -->
              <div v-if="modelsForProvider(p.provider).length === 0" class="rounded-lg border border-dashed border-[#c8d6c9] p-6 text-center text-xs text-[#667768]">
                Chưa có model nào cho nhà cung cấp này.
                <template v-if="p.provider === 'delify'">
                  Bấm nút <strong>"⚡ Tải model & giá từ Delify API"</strong> ở trên để nạp tự động toàn bộ model của Delify!
                </template>
                <template v-else>
                  Bấm <strong>"Thêm Model"</strong> để cấu hình model đầu tiên.
                </template>
              </div>

              <div v-else class="rounded-lg border border-[#e2ece3] overflow-x-auto">
                <table class="w-full text-xs">
                  <thead class="bg-[#f7faf7] text-left">
                    <tr>
                      <th class="px-2.5 py-2 w-8 text-center">
                        <input
                          type="checkbox"
                          class="w-3.5 h-3.5 accent-[#2c6e33] rounded cursor-pointer"
                          :checked="isAllModelsSelectedForProvider(p.provider)"
                          title="Chọn tất cả model của nhà cung cấp này"
                          @change="toggleSelectAllModelsForProvider(p.provider)"
                        />
                      </th>
                      <th class="px-3 py-2 font-bold text-[#122815]">Trạng thái</th>
                      <th class="px-3 py-2 font-bold text-[#122815]">Mã Model (API)</th>
                      <th class="px-3 py-2 font-bold text-[#122815]">Tên hiển thị</th>
                      <th class="px-3 py-2 font-bold text-[#122815] text-right">Giá Input ($/1M)</th>
                      <th class="px-3 py-2 font-bold text-[#122815] text-right">Giá Output ($/1M)</th>
                      <th class="px-3 py-2 font-bold text-[#122815] text-right">Ước tính / call</th>
                      <th class="px-3 py-2 font-bold text-[#122815] text-center">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="m in modelsForProvider(p.provider)"
                      :key="m.model"
                      class="border-t border-[#e2ece3] hover:bg-[#fafcfa] transition-colors"
                      :class="!m.isActive ? 'opacity-50 bg-[#fafafa]' : ''"
                    >
                      <td class="px-2.5 py-2 text-center">
                        <input
                          type="checkbox"
                          class="w-3.5 h-3.5 accent-[#2c6e33] rounded cursor-pointer"
                          :checked="isModelSelected(m.model)"
                          @change="toggleSelectModel(m.model)"
                        />
                      </td>
                      <!-- 9Router style toggle switch -->
                      <td class="px-3 py-2">
                        <button
                          type="button"
                          class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none"
                          :class="m.isActive ? 'bg-[#2c6e33]' : 'bg-gray-300'"
                          :title="m.isActive ? 'Bấm để tắt model này' : 'Bấm để bật model này'"
                          @click="toggleModelActive(m)"
                        >
                          <span
                            aria-hidden="true"
                            class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                            :class="m.isActive ? 'translate-x-4' : 'translate-x-0'"
                          ></span>
                        </button>
                      </td>
                      <td class="px-3 py-2 font-mono font-bold text-[#122815]">{{ m.model }}</td>
                      <td class="px-3 py-2 text-[#667768]">{{ m.label ?? '—' }}</td>
                      <td class="px-3 py-2 text-right font-mono text-[#2c6e33]">${{ m.promptCostPerMillion }}</td>
                      <td class="px-3 py-2 text-right font-mono text-[#2c6e33]">${{ m.completionCostPerMillion }}</td>
                      <td class="px-3 py-2 text-right text-[#667768] font-mono">
                        {{ estimatedCostVnd(m.promptCostPerMillion, m.completionCostPerMillion) }}
                      </td>
                      <td class="px-3 py-2 text-center whitespace-nowrap">
                        <button
                          type="button"
                          class="px-2 py-0.5 rounded border border-[#c8d6c9] bg-white text-xs font-bold text-[#2c6e33] hover:bg-[#f0f7f1] mr-2 transition-colors inline-flex items-center gap-1"
                          :disabled="testingModelKey === m.model"
                          title="Gọi thử nghiệm model này (Xin chào...)"
                          @click="testCallModel(p.provider, m.model)"
                        >
                          <i class="fa-solid fa-bolt text-[0.65rem]" aria-hidden="true"></i>
                          {{ testingModelKey === m.model ? 'Đang gọi...' : 'Test' }}
                        </button>
                        <button type="button" class="text-[#2c6e33] font-semibold hover:underline mr-2" @click="openEditModel(m)">
                          Sửa giá
                        </button>
                        <button type="button" class="text-[#d12420] font-semibold hover:underline" @click="deleteModel(m)">
                          Xoá
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <!-- ── Modals ────────────────────────────────────────────────── -->

        <!-- Create Provider Modal -->
        <div v-if="showCreateForm" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="showCreateForm = false">
          <div class="bg-white rounded-2xl p-6 max-w-lg w-full flex flex-col gap-4" @click.stop>
            <h2 class="m-0 text-lg font-bold text-[#122815]">Thêm nhà cung cấp mới</h2>
            <label class="flex flex-col gap-1.5 text-sm font-bold">
              <span class="text-[#122815]">Loại nhà cung cấp</span>
              <select v-model="newProviderForm.provider" class="rounded-lg border border-[#d0ddd1] px-3 py-2 text-sm bg-white" @change="onNewProviderPresetChange()">
                <option v-for="preset in PROVIDER_PRESETS" :key="preset.value" :value="preset.value">{{ preset.label }}</option>
              </select>
              <span v-if="PROVIDER_PRESETS.find(p => p.value === newProviderForm.provider)?.hint" class="text-xs text-[#667768] font-normal">
                {{ PROVIDER_PRESETS.find(p => p.value === newProviderForm.provider)?.hint }}
              </span>
            </label>
            <label class="flex flex-col gap-1.5 text-sm font-bold">
              <span class="text-[#122815]">Nhãn hiển thị</span>
              <input v-model="newProviderForm.label" type="text" class="rounded-lg border border-[#d0ddd1] px-3 py-2 text-sm" />
            </label>
            <label class="flex flex-col gap-1.5 text-sm font-bold">
              <span class="text-[#122815]">Base URL</span>
              <input v-model="newProviderForm.baseUrl" type="text" placeholder="https://..." class="rounded-lg border border-[#d0ddd1] px-3 py-2 text-sm" />
            </label>
            <label class="flex items-center gap-3 text-sm font-semibold">
              <input v-model="newProviderForm.isActive" type="checkbox" class="w-4 h-4 accent-[#2c6e33]" />
              <span class="text-[#122815]">Kích hoạt nhà cung cấp</span>
            </label>
            <label class="flex flex-col gap-1.5 text-sm font-bold">
              <span class="text-[#122815]">API Key</span>
              <input v-model="newProviderForm.apiKey" type="password" placeholder="Nhập API key" class="rounded-lg border border-[#d0ddd1] px-3 py-2 text-sm" />
              <span class="text-xs text-[#667768] font-normal">Có thể nhập sau nếu chưa có.</span>
            </label>
            <div v-if="newProviderError" class="rounded-lg border border-[#f1b8b5] bg-[#fff4f3] p-3 text-sm text-[#a32924]" role="alert">{{ newProviderError }}</div>
            <div class="flex justify-end gap-2">
              <button type="button" class="px-4 py-2 rounded-lg border border-[#d0ddd1] text-sm font-semibold text-[#667768] hover:bg-[#f4f7f4]" @click="showCreateForm = false">Huỷ</button>
              <button type="button" class="px-4 py-2 rounded-lg bg-[#2c6e33] text-white text-sm font-semibold hover:bg-[#1e4620]" @click="createProvider()" :disabled="savingNewProvider">
                {{ savingNewProvider ? 'Đang thêm...' : 'Thêm' }}
              </button>
            </div>
          </div>
        </div>

        <!-- Edit Provider Modal -->
        <div v-if="editingProvider" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="editingProvider = null">
          <div class="bg-white rounded-2xl p-6 max-w-lg w-full flex flex-col gap-4" @click.stop>
            <h2 class="m-0 text-lg font-bold text-[#122815]">Cài đặt kết nối: {{ editingProvider.label }}</h2>
            <label class="flex flex-col gap-1.5 text-sm font-bold">
              <span class="text-[#122815]">Nhãn hiển thị</span>
              <input v-model="providerForm.label" type="text" class="rounded-lg border border-[#d0ddd1] px-3 py-2 text-sm" />
            </label>
            <label class="flex flex-col gap-1.5 text-sm font-bold">
              <span class="text-[#122815]">Base URL</span>
              <input v-model="providerForm.baseUrl" type="text" placeholder="https://..." class="rounded-lg border border-[#d0ddd1] px-3 py-2 text-sm" />
            </label>
            <label class="flex items-center gap-3 text-sm font-semibold">
              <input v-model="providerForm.isActive" type="checkbox" class="w-4 h-4 accent-[#2c6e33]" />
              <span class="text-[#122815]">Kích hoạt nhà cung cấp</span>
            </label>
            <label class="flex flex-col gap-1.5 text-sm font-bold">
              <span class="text-[#122815]">API Key mới</span>
              <input v-model="providerForm.apiKey" type="password" :placeholder="editingProvider.apiKeyLastFour ? '••••' + editingProvider.apiKeyLastFour + ' (đã lưu)' : 'Nhập API key'" class="rounded-lg border border-[#d0ddd1] px-3 py-2 text-sm" />
              <span class="text-xs text-[#667768] font-normal">Để trống để giữ nguyên key hiện tại.</span>
            </label>
            <div v-if="testResult" class="rounded-lg p-3 text-sm" :class="testResult.includes('Thất bại') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'" role="status">{{ testResult }}</div>
            <div class="flex justify-between gap-3">
              <button type="button" class="px-4 py-2 rounded-lg border border-[#d0ddd1] text-sm font-semibold text-[#667768] hover:bg-[#f4f7f4]" @click="testProvider(editingProvider.id)" :disabled="!!testingProvider">
                {{ testingProvider ? 'Đang kiểm tra...' : 'Kiểm tra kết nối' }}
              </button>
              <div class="flex gap-2">
                <button type="button" class="px-4 py-2 rounded-lg border border-[#d0ddd1] text-sm font-semibold text-[#667768] hover:bg-[#f4f7f4]" @click="editingProvider = null">Huỷ</button>
                <button type="button" class="px-4 py-2 rounded-lg bg-[#2c6e33] text-white text-sm font-semibold hover:bg-[#1e4620]" @click="saveProvider()" :disabled="savingProvider">
                  {{ savingProvider ? 'Đang lưu...' : 'Lưu' }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Add Model to Provider Modal -->
        <div v-if="showAddModelModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="showAddModelModal = false">
          <div class="bg-white rounded-2xl p-6 max-w-lg w-full flex flex-col gap-4" @click.stop>
            <h2 class="m-0 text-lg font-bold text-[#122815]">Thêm Model cho {{ targetProviderForModel }}</h2>
            <label class="flex flex-col gap-1.5 text-sm font-bold">
              <span class="text-[#122815]">Mã Model (ID gọi API)</span>
              <input v-model="newModelForm.model" type="text" placeholder="flash, glm-5.3, gpt-4o..." class="rounded-lg border border-[#d0ddd1] px-3 py-2 text-sm font-mono" />
            </label>
            <label class="flex flex-col gap-1.5 text-sm font-bold">
              <span class="text-[#122815]">Tên hiển thị (Label)</span>
              <input v-model="newModelForm.label" type="text" placeholder="GLM 5.3 Thông minh..." class="rounded-lg border border-[#d0ddd1] px-3 py-2 text-sm" />
            </label>
            <div class="grid grid-cols-2 gap-3">
              <label class="flex flex-col gap-1.5 text-sm font-bold">
                <span class="text-[#122815]">Giá Input ($ / 1M)</span>
                <input v-model.number="newModelForm.promptCostPerMillion" type="number" step="0.001" min="0" class="rounded-lg border border-[#d0ddd1] px-3 py-2 text-sm" />
              </label>
              <label class="flex flex-col gap-1.5 text-sm font-bold">
                <span class="text-[#122815]">Giá Output ($ / 1M)</span>
                <input v-model.number="newModelForm.completionCostPerMillion" type="number" step="0.001" min="0" class="rounded-lg border border-[#d0ddd1] px-3 py-2 text-sm" />
              </label>
            </div>
            <label class="flex items-center gap-3 text-sm font-semibold">
              <input v-model="newModelForm.isActive" type="checkbox" class="w-4 h-4 accent-[#2c6e33]" />
              <span class="text-[#122815]">Kích hoạt model (cho phép các dịch vụ sử dụng)</span>
            </label>
            <div v-if="newModelError" class="rounded-lg border border-[#f1b8b5] bg-[#fff4f3] p-3 text-sm text-[#a32924]" role="alert">{{ newModelError }}</div>
            <div class="flex justify-end gap-2">
              <button type="button" class="px-4 py-2 rounded-lg border border-[#d0ddd1] text-sm font-semibold text-[#667768] hover:bg-[#f4f7f4]" @click="showAddModelModal = false">Huỷ</button>
              <button type="button" class="px-4 py-2 rounded-lg bg-[#2c6e33] text-white text-sm font-semibold hover:bg-[#1e4620]" @click="addModelToProvider()" :disabled="savingNewModel">
                {{ savingNewModel ? 'Đang thêm...' : 'Thêm Model' }}
              </button>
            </div>
          </div>
        </div>

        <!-- Edit Model Price Modal -->
        <div v-if="editingModel" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="editingModel = null">
          <div class="bg-white rounded-2xl p-6 max-w-lg w-full flex flex-col gap-4" @click.stop>
            <h2 class="m-0 text-lg font-bold text-[#122815]">Sửa Model: <span class="font-mono text-[#2c6e33]">{{ editingModel.model }}</span></h2>
            <p class="m-0 text-xs text-[#667768]">Nhà cung cấp: <strong>{{ editingModel.provider }}</strong></p>
            <label class="flex flex-col gap-1.5 text-sm font-bold">
              <span class="text-[#122815]">Tên hiển thị</span>
              <input v-model="editModelForm.label" type="text" class="rounded-lg border border-[#d0ddd1] px-3 py-2 text-sm" />
            </label>
            <div class="grid grid-cols-2 gap-3">
              <label class="flex flex-col gap-1.5 text-sm font-bold">
                <span class="text-[#122815]">Giá Input ($ / 1M)</span>
                <input v-model.number="editModelForm.promptCostPerMillion" type="number" step="0.001" min="0" class="rounded-lg border border-[#d0ddd1] px-3 py-2 text-sm" />
              </label>
              <label class="flex flex-col gap-1.5 text-sm font-bold">
                <span class="text-[#122815]">Giá Output ($ / 1M)</span>
                <input v-model.number="editModelForm.completionCostPerMillion" type="number" step="0.001" min="0" class="rounded-lg border border-[#d0ddd1] px-3 py-2 text-sm" />
              </label>
            </div>
            <label class="flex items-center gap-3 text-sm font-semibold">
              <input v-model="editModelForm.isActive" type="checkbox" class="w-4 h-4 accent-[#2c6e33]" />
              <span class="text-[#122815]">Kích hoạt model này</span>
            </label>
            <div class="flex justify-end gap-2">
              <button type="button" class="px-4 py-2 rounded-lg border border-[#d0ddd1] text-sm font-semibold text-[#667768] hover:bg-[#f4f7f4]" @click="editingModel = null">Huỷ</button>
              <button type="button" class="px-4 py-2 rounded-lg bg-[#2c6e33] text-white text-sm font-semibold hover:bg-[#1e4620]" @click="saveEditModel()" :disabled="savingModelEdit">
                {{ savingModelEdit ? 'Đang lưu...' : 'Lưu' }}
              </button>
            </div>
          </div>
        </div>

        <!-- Model Test Call Result Modal (9Router style) -->
        <div v-if="modelTestModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="modelTestModal = null">
          <div class="bg-white rounded-2xl p-6 max-w-xl w-full flex flex-col gap-4 shadow-xl" @click.stop>
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2.5">
                <div class="w-9 h-9 rounded-xl bg-[#e4f0e2] text-[#2c6e33] flex items-center justify-center font-bold text-base">
                  <i class="fa-solid fa-bolt" aria-hidden="true"></i>
                </div>
                <div>
                  <h2 class="m-0 text-base font-extrabold text-[#122815]">
                    Test Call: <span class="font-mono text-[#2c6e33]">{{ modelTestModal.model }}</span>
                  </h2>
                  <p class="m-0 text-xs text-[#667768]">Nhà cung cấp: <strong>{{ modelTestModal.provider }}</strong></p>
                </div>
              </div>
              <span
                class="px-2.5 py-1 rounded-full text-xs font-bold"
                :class="!modelTestModal.error ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'"
              >
                {{ !modelTestModal.error ? 'Thành công (200 OK)' : 'Thất bại' }}
              </span>
            </div>

            <!-- Metrics if success -->
            <div v-if="!modelTestModal.error" class="grid grid-cols-3 gap-2 p-3 rounded-xl bg-[#f4f7f4] text-xs">
              <div>
                <span class="text-[#667768]">Thời gian</span>
                <p class="m-0 font-bold text-[#122815] font-mono">{{ modelTestModal.durationMs }}ms</p>
              </div>
              <div>
                <span class="text-[#667768]">Tokens tiêu thụ</span>
                <p class="m-0 font-bold text-[#122815] font-mono">{{ modelTestModal.usage.totalTokens }} ({{ modelTestModal.usage.promptTokens }} in / {{ modelTestModal.usage.completionTokens }} out)</p>
              </div>
              <div>
                <span class="text-[#667768]">Chi phí ước tính</span>
                <p class="m-0 font-bold text-[#2c6e33] font-mono">{{ formatVnd(modelTestModal.costVnd) }}</p>
              </div>
            </div>

            <!-- Response text or error -->
            <div v-if="!modelTestModal.error" class="flex flex-col gap-1.5">
              <span class="text-xs font-bold text-[#667768] uppercase">Phản hồi từ Model:</span>
              <div class="rounded-xl border border-[#c8d6c9] bg-[#fafcfa] p-3.5 text-sm text-[#122815] whitespace-pre-wrap font-sans leading-relaxed max-h-[220px] overflow-y-auto">
                {{ modelTestModal.reply }}
              </div>
            </div>
            <div v-else class="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-700 font-mono whitespace-pre-wrap">
              {{ modelTestModal.error }}
            </div>

            <div class="flex justify-end pt-2 border-t border-[#e2ece3]">
              <button type="button" class="px-5 py-2 rounded-lg bg-[#2c6e33] text-white text-sm font-semibold hover:bg-[#1e4620]" @click="modelTestModal = null">
                Đóng
              </button>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- ─── Services Tab ──────────────────────────────────────────────── -->
    <div v-if="activeTab === 'services'" class="flex flex-col gap-5">
      <div v-if="servicesError" class="rounded-lg border border-[#f1b8b5] bg-[#fff4f3] p-3 text-sm text-[#a32924]" role="alert">
        <strong>Lỗi:</strong> {{ servicesError }}
        <button type="button" class="font-bold underline text-[#4A6741] ml-2" @click="loadServices()">Thử lại</button>
      </div>

      <div v-if="servicesLoading" class="flex items-center justify-center py-12" role="status" aria-busy="true">
        <span class="sr-only">Đang tải danh sách dịch vụ</span>
        <div class="flex gap-1.5" aria-hidden="true">
          <span class="w-2.5 h-2.5 rounded-full bg-[#2c6e33] animate-pulse motion-reduce:animate-none"></span>
          <span class="w-2.5 h-2.5 rounded-full bg-[#2c6e33] animate-pulse motion-reduce:animate-none" style="animation-delay: 0.15s"></span>
          <span class="w-2.5 h-2.5 rounded-full bg-[#2c6e33] animate-pulse motion-reduce:animate-none" style="animation-delay: 0.3s"></span>
        </div>
      </div>

      <template v-if="!servicesLoading && !servicesError">
        <div class="rounded-xl border border-[#e2ece3] bg-white overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-[#f4f7f4] text-left">
              <tr>
                <th class="px-4 py-3 font-bold text-[#122815]">Dịch vụ</th>
                <th class="px-4 py-3 font-bold text-[#122815]">Nhà cung cấp</th>
                <th class="px-4 py-3 font-bold text-[#122815]">Model đang dùng</th>
                <th class="px-4 py-3 font-bold text-[#122815]">Trạng thái</th>
                <th class="px-4 py-3 font-bold text-[#122815]">Cập nhật</th>
                <th class="px-4 py-3 font-bold text-[#122815]"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in services" :key="s.id" class="border-t border-[#e2ece3]">
                <td class="px-4 py-3 font-semibold text-[#122815]">{{ s.serviceName }}</td>
                <td class="px-4 py-3 text-[#2c6e33] font-semibold">{{ s.provider }}</td>
                <td class="px-4 py-3 text-[#122815] font-mono">{{ s.model ?? '—' }}</td>
                <td class="px-4 py-3">
                  <span :class="s.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'" class="px-2 py-0.5 rounded-full text-xs font-semibold">
                    {{ s.isActive ? 'Bật' : 'Tắt' }}
                  </span>
                </td>
                <td class="px-4 py-3 text-[#667768] text-xs">{{ formatTime(s.updatedAt) }}</td>
                <td class="px-4 py-3">
                  <button type="button" class="text-[#2c6e33] font-semibold text-xs hover:underline" @click="openServiceEdit(s)">Cấu hình</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Edit Service Drawer -->
        <div v-if="editingService" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="editingService = null">
          <div class="bg-white rounded-2xl p-6 max-w-2xl w-full flex flex-col gap-4 max-h-[90vh] overflow-y-auto" @click.stop>
            <h2 class="m-0 text-lg font-bold text-[#122815]">Cấu hình: {{ editingService.serviceName }}</h2>

            <!-- 1. Chọn Nhà cung cấp -->
            <label class="flex flex-col gap-1.5 text-sm font-bold">
              <span class="text-[#122815]">Nhà cung cấp (Provider)</span>
              <select v-model="serviceForm.provider" class="rounded-lg border border-[#d0ddd1] px-3 py-2 text-sm bg-white">
                <option v-for="p in providers.filter(pr => pr.isActive)" :key="p.provider" :value="p.provider">
                  {{ p.label }} ({{ p.provider }})
                </option>
                <option v-if="!providers.some(pr => pr.provider === serviceForm.provider && pr.isActive)" :value="serviceForm.provider">
                  {{ serviceForm.provider }}
                </option>
              </select>
              <span class="text-xs text-[#667768] font-normal">Chỉ hiển thị nhà cung cấp đang hoạt động.</span>
            </label>

            <!-- 2. Chọn Model (Lọc theo NCC đã chọn - 9Router style) -->
            <div class="flex flex-col gap-1.5 text-sm font-bold">
              <div class="flex items-center justify-between">
                <span class="text-[#122815]">Model sử dụng</span>
                <span class="text-xs text-[#667768] font-normal">
                  Chỉ hiển thị model <strong>đang bật</strong> của {{ serviceForm.provider }}
                </span>
              </div>
              <div class="flex flex-col gap-2">
                <select v-if="activeModelsForSelectedProvider.length > 0" v-model="serviceForm.model" class="rounded-lg border border-[#d0ddd1] px-3 py-2 text-sm bg-white">
                  <option value="">— Chọn model đang bật —</option>
                  <option v-for="m in activeModelsForSelectedProvider" :key="m.model" :value="m.model">
                    {{ m.model }} {{ m.label ? `(${m.label})` : '' }} — ${{ m.promptCostPerMillion }} in / ${{ m.completionCostPerMillion }} out
                  </option>
                </select>
                <div v-else class="rounded-lg border border-dashed border-[#c8d6c9] p-3 text-xs text-[#a32924] bg-red-50/50">
                  Chưa có model nào được bật cho nhà cung cấp này. Vui lòng vào tab <strong>"Nhà cung cấp & Models"</strong> để bật ít nhất 1 model.
                </div>
                <input
                  v-model="serviceForm.model"
                  type="text"
                  placeholder="Hoặc nhập thủ công mã model khác..."
                  class="rounded-lg border border-[#d0ddd1] px-3 py-1.5 text-xs font-mono"
                />
              </div>
            </div>

            <!-- 3. System Prompt -->
            <label class="flex flex-col gap-1.5 text-sm font-bold">
              <span class="text-[#122815]">System Prompt</span>
              <textarea v-model="serviceForm.systemPrompt" rows="7" class="rounded-lg border border-[#d0ddd1] px-3 py-2 text-sm font-mono resize-y" placeholder="Nhập system prompt..."></textarea>
            </label>
            <div v-if="TEMPLATE_HINTS[editingService.serviceKey]" class="flex flex-col gap-1 text-xs text-[#667768]">
              <span class="font-bold">Biến template có sẵn:</span>
              <div class="flex flex-wrap gap-1">
                <code v-for="hint in TEMPLATE_HINTS[editingService.serviceKey]" :key="hint" class="px-2 py-0.5 rounded bg-[#f4f7f4] text-[#2c6e33]">{{ hint }}</code>
              </div>
            </div>

            <!-- 4. Parameters -->
            <div class="grid grid-cols-2 gap-4">
              <label class="flex flex-col gap-1.5 text-sm font-bold">
                <span class="text-[#122815]">Temperature: {{ serviceForm.temperature }}</span>
                <input v-model="serviceForm.temperature" type="range" min="0" max="2" step="0.01" class="accent-[#2c6e33]" />
              </label>
              <label class="flex flex-col gap-1.5 text-sm font-bold">
                <span class="text-[#122815]">Max Tokens</span>
                <input v-model.number="serviceForm.maxTokens" type="number" min="1" max="32768" class="rounded-lg border border-[#d0ddd1] px-3 py-2 text-sm" />
              </label>
            </div>

            <label class="flex items-center gap-3 text-sm font-semibold">
              <input v-model="serviceForm.isActive" type="checkbox" class="w-4 h-4 accent-[#2c6e33]" />
              <span class="text-[#122815]">Kích hoạt dịch vụ này</span>
            </label>

            <!-- Test result banner -->
            <div v-if="serviceTestResult" class="rounded-xl p-3.5 text-xs flex flex-col gap-2 transition-all" :class="serviceTestResult.startsWith('Thành công') ? 'bg-green-50 text-green-900 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'" role="status">
              <div class="font-bold flex items-center gap-1.5 text-sm">
                <i :class="serviceTestResult.startsWith('Thành công') ? 'fa-solid fa-circle-check text-green-600' : 'fa-solid fa-triangle-exclamation text-red-600'" aria-hidden="true"></i>
                <span>{{ serviceTestResult.startsWith('Thành công') ? 'Kiểm tra thành công (Model phản hồi thực tế)' : 'Kiểm tra thất bại' }}</span>
              </div>
              <div class="whitespace-pre-wrap font-sans text-xs leading-relaxed bg-white/70 p-2.5 rounded-lg border border-black/5">
                {{ serviceTestResult }}
              </div>
            </div>

            <!-- Footer actions -->
            <div class="flex justify-between gap-3 pt-2 border-t border-[#e2ece3]">
              <button
                type="button"
                class="px-4 py-2 rounded-lg border border-[#d0ddd1] text-sm font-semibold text-[#122815] hover:bg-[#f0f7f1]"
                :disabled="testingService"
                @click="testService()"
              >
                {{ testingService ? 'Đang test...' : 'Kiểm tra kết nối' }}
              </button>
              <div class="flex gap-2">
                <button type="button" class="px-4 py-2 rounded-lg border border-[#d0ddd1] text-sm font-semibold text-[#667768] hover:bg-[#f4f7f4]" @click="editingService = null">Huỷ</button>
                <button type="button" class="px-4 py-2 rounded-lg bg-[#2c6e33] text-white text-sm font-semibold hover:bg-[#1e4620]" @click="saveService()" :disabled="savingService">
                  {{ savingService ? 'Đang lưu...' : 'Lưu cấu hình' }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- ─── Moderation Tab (Security & Content Verification) ─────────────── -->
    <div v-if="activeTab === 'moderation'" class="flex flex-col gap-5">
      <div v-if="moderationError" class="rounded-lg border border-[#f1b8b5] bg-[#fff4f3] p-3 text-sm text-[#a32924]" role="alert">
        <strong>Lỗi:</strong> {{ moderationError }}
        <button type="button" class="font-bold underline text-[#4A6741] ml-2 cursor-pointer" @click="loadModeration()">Thử lại</button>
      </div>

      <!-- Moderation Sub-tabs -->
      <div class="flex flex-wrap items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-[#e2ece3]">
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 border"
            :class="moderationSubTab === 'queue' ? 'bg-[#1e4620] text-white border-[#1e4620] shadow-xs' : 'bg-white text-[#667768] border-[#c8d6c9] hover:bg-[#f0f7f1]'"
            @click="moderationSubTab = 'queue'"
          >
            <i class="fa-solid fa-inbox"></i>
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
            <i class="fa-solid fa-list-check"></i>
            <span>Quy tắc kiểm duyệt an ninh ({{ moderationRules.length }})</span>
          </button>
        </div>

        <button
          type="button"
          class="px-3 py-1.5 rounded-lg border border-[#c8d6c9] bg-white text-xs font-semibold text-[#1e4620] hover:bg-[#f0f7f1] transition-colors cursor-pointer flex items-center gap-1.5"
          :disabled="moderationLoading"
          @click="loadModeration()"
        >
          <i class="fa-solid fa-rotate text-xs" :class="moderationLoading ? 'animate-spin' : ''"></i>
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
          <div class="flex items-center gap-2">
            <span class="text-xs font-bold text-[#667768]">Lọc trạng thái:</span>
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
            <i class="fa-solid fa-shield-check text-3xl text-[#2c6e33] mb-2 block"></i>
            Không có mục nào trong danh sách đối soát. Hệ thống an ninh đang hoạt động tốt.
          </div>

          <!-- Queue list table -->
          <div v-else class="rounded-xl border border-[#e2ece3] bg-white overflow-x-auto shadow-xs">
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
                    <!-- Vị trí cụ thể: bài viết / video / phiên chat -->
                    <div v-if="item.contextTitle" class="mt-1 max-w-[220px]">
                      <a v-if="item.contextUrl" :href="item.contextUrl" target="_blank" class="block font-bold text-[#1e4620] hover:underline truncate text-xs" :title="item.contextTitle">
                        {{ item.contextTitle }}
                      </a>
                      <span v-else class="block font-bold text-[#1e4620] truncate text-xs" :title="item.contextTitle">
                        {{ item.contextTitle }}
                      </span>
                    </div>
                    <!-- Session ID nếu có -->
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
                        <i class="fa-solid fa-check mr-1"></i> Bỏ ẩn
                      </button>
                      <button
                        v-if="item.status !== 'rejected'"
                        type="button"
                        class="px-2 py-1 rounded bg-[#fee2e2] hover:bg-[#fca5a5] text-[#b42318] text-[0.7rem] font-bold cursor-pointer border-none"
                        title="Xóa vĩnh viễn nội dung vi phạm"
                        @click="resolveQueueItem(item, 'reject_delete')"
                      >
                        <i class="fa-solid fa-trash-can mr-1"></i> Xóa
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
                        <i class="fa-solid fa-ban mr-1"></i>
                        <span>{{ item.isIpBanned ? 'Đã cấm IP' : 'Cấm IP' }}</span>
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- ── SUBTAB 2: SECURITY RULES ── -->
        <div v-else class="flex flex-col gap-5">
          <!-- Add Rule Form -->
          <div class="rounded-xl border border-[#c8d6c9] bg-[#f0f7f1] p-4 flex flex-col gap-3 shadow-xs">
            <h3 class="m-0 text-sm font-extrabold text-[#122815] flex items-center gap-2">
              <i class="fa-solid fa-plus-circle text-[#2c6e33]"></i>
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
                class="px-4 py-2 rounded-lg bg-[#2c6e33] hover:bg-[#1e4620] text-white text-xs font-bold cursor-pointer border-none shadow-xs"
              >
                + Thêm quy tắc
              </button>
            </form>
          </div>

          <!-- Rules List Table -->
          <div class="rounded-xl border border-[#e2ece3] bg-white overflow-x-auto shadow-xs">
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
        </div>
      </template>
    </div>

    <!-- ─── Logs Tab ───────────────────────────────────────────────────── -->
    <div v-if="activeTab === 'logs'" class="flex flex-col gap-5">
      <div v-if="logsError" class="rounded-lg border border-[#f1b8b5] bg-[#fff4f3] p-3 text-sm text-[#a32924]" role="alert">
        <strong>Lỗi:</strong> {{ logsError }}
        <button type="button" class="font-bold underline text-[#4A6741] ml-2" @click="loadLogs()">Thử lại</button>
      </div>

      <!-- Filters -->
      <div class="rounded-xl border border-[#e2ece3] bg-white p-4">
        <div class="flex flex-wrap gap-3 items-end">
          <label class="flex flex-col gap-1 text-xs font-semibold">
            <span class="text-[#667768]">Dịch vụ</span>
            <select v-model="logsFilters.serviceKey" class="rounded-lg border border-[#d0ddd1] px-3 py-1.5 text-sm bg-white">
              <option value="">Tất cả</option>
              <option v-for="key in Object.keys(SERVICE_LABELS)" :key="key" :value="key">{{ SERVICE_LABELS[key] }}</option>
            </select>
          </label>
          <label class="flex flex-col gap-1 text-xs font-semibold">
            <span class="text-[#667768]">Nhà cung cấp</span>
            <select v-model="logsFilters.provider" class="rounded-lg border border-[#d0ddd1] px-3 py-1.5 text-sm bg-white">
              <option value="">Tất cả</option>
              <option v-for="p in providers" :key="p.provider" :value="p.provider">{{ p.label }}</option>
            </select>
          </label>
          <label class="flex flex-col gap-1 text-xs font-semibold">
            <span class="text-[#667768]">Từ ngày</span>
            <input v-model="logsFilters.startDate" type="date" class="rounded-lg border border-[#d0ddd1] px-3 py-1.5 text-sm" />
          </label>
          <label class="flex flex-col gap-1 text-xs font-semibold">
            <span class="text-[#667768]">Đến ngày</span>
            <input v-model="logsFilters.endDate" type="date" class="rounded-lg border border-[#d0ddd1] px-3 py-1.5 text-sm" />
          </label>
          <label class="flex flex-col gap-1 text-xs font-semibold">
            <span class="text-[#667768]">Trạng thái</span>
            <select v-model="logsFilters.success" class="rounded-lg border border-[#d0ddd1] px-3 py-1.5 text-sm bg-white">
              <option value="">Tất cả</option>
              <option value="true">Thành công</option>
              <option value="false">Lỗi</option>
            </select>
          </label>
          <button type="button" class="px-4 py-1.5 rounded-lg bg-[#2c6e33] text-white text-sm font-semibold hover:bg-[#1e4620]" @click="applyFilters">Lọc</button>
        </div>
        <p class="m-0 mt-3 text-xs text-[#667768]">Chỉ hiển thị nhật ký 90 ngày gần nhất.</p>
      </div>

      <div v-if="logsLoading" class="flex items-center justify-center py-12" role="status" aria-busy="true">
        <span class="sr-only">Đang tải nhật ký</span>
        <div class="flex gap-1.5" aria-hidden="true">
          <span class="w-2.5 h-2.5 rounded-full bg-[#2c6e33] animate-pulse motion-reduce:animate-none"></span>
          <span class="w-2.5 h-2.5 rounded-full bg-[#2c6e33] animate-pulse motion-reduce:animate-none" style="animation-delay: 0.15s"></span>
          <span class="w-2.5 h-2.5 rounded-full bg-[#2c6e33] animate-pulse motion-reduce:animate-none" style="animation-delay: 0.3s"></span>
        </div>
      </div>

      <template v-if="!logsLoading && !logsError">
        <div v-if="logs.length === 0" class="rounded-xl border border-[#e2ece3] bg-white p-8 text-center text-sm text-[#667768]">
          Chưa có nhật ký nào.
        </div>
        <div v-else class="rounded-xl border border-[#e2ece3] bg-white overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-[#f4f7f4] text-left">
              <tr>
                <th class="px-3 py-3 font-bold text-[#122815]">Thời gian</th>
                <th class="px-3 py-3 font-bold text-[#122815]">Dịch vụ</th>
                <th class="px-3 py-3 font-bold text-[#122815]">Nhà cung cấp</th>
                <th class="px-3 py-3 font-bold text-[#122815]">Model</th>
                <th class="px-3 py-3 font-bold text-[#122815] text-right">Input</th>
                <th class="px-3 py-3 font-bold text-[#122815] text-right">Output</th>
                <th class="px-3 py-3 font-bold text-[#122815] text-right">Chi phí</th>
                <th class="px-3 py-3 font-bold text-[#122815] text-right">Thời gian</th>
                <th class="px-3 py-3 font-bold text-[#122815]">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="log in logs" :key="log.id">
                <tr
                  class="border-t border-[#e2ece3] cursor-pointer hover:bg-[#f4f7f4]"
                  :class="!log.success ? 'bg-red-50/50' : ''"
                  @click="!log.success && toggleRowExpand(log.id)"
                >
                  <td class="px-3 py-2.5 text-xs text-[#667768] whitespace-nowrap">{{ formatTime(log.createdAt) }}</td>
                  <td class="px-3 py-2.5 font-semibold text-[#122815]">{{ SERVICE_LABELS[log.serviceKey] ?? log.serviceKey }}</td>
                  <td class="px-3 py-2.5 text-[#667768]">{{ log.provider }}</td>
                  <td class="px-3 py-2.5 text-[#122815] font-mono">{{ log.model ?? '—' }}</td>
                  <td class="px-3 py-2.5 text-right text-[#667768]">{{ formatNum(log.promptTokens) }}</td>
                  <td class="px-3 py-2.5 text-right text-[#667768]">{{ formatNum(log.completionTokens) }}</td>
                  <td class="px-3 py-2.5 text-right text-[#2c6e33] font-mono font-bold whitespace-nowrap">{{ formatVnd(Number(log.costVnd)) }}</td>
                  <td class="px-3 py-2.5 text-right text-[#667768]">{{ log.executionMs }}ms</td>
                  <td class="px-3 py-2.5">
                    <span :class="log.success ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'" class="px-2 py-0.5 rounded-full text-xs font-semibold">
                      {{ log.success ? 'OK' : 'Lỗi' }}
                    </span>
                  </td>
                </tr>
                <tr v-if="!log.success && expandedRows.has(log.id)" class="border-t border-[#e2ece3] bg-red-50/30">
                  <td colspan="9" class="px-3 py-3">
                    <div class="rounded-lg bg-red-50 p-3 text-xs text-red-700 font-mono">{{ log.errorMessage ?? 'Không có chi tiết lỗi.' }}</div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>

        <!-- Pagination -->
        <div v-if="logsPagination.totalPages > 1" class="flex items-center justify-between">
          <p class="text-sm text-[#667768]">Tổng {{ logsPagination.total }} bản ghi — Trang {{ logsPagination.page }}/{{ logsPagination.totalPages }}</p>
          <div class="flex gap-2">
            <button type="button" class="px-3 py-1.5 rounded-lg border border-[#d0ddd1] text-sm font-semibold text-[#667768] hover:bg-[#f4f7f4]" :disabled="logsPagination.page <= 1" @click="goToPage(logsPagination.page - 1)">Trước</button>
            <button type="button" class="px-3 py-1.5 rounded-lg border border-[#d0ddd1] text-sm font-semibold text-[#667768] hover:bg-[#f4f7f4]" :disabled="logsPagination.page >= logsPagination.totalPages" @click="goToPage(logsPagination.page + 1)">Sau</button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
