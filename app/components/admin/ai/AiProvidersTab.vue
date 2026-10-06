<script setup lang="ts">
/**
 * Providers & Models tab của AI Panel — Quản lý API key, kết nối, model + giá cho
 * từng nhà cung cấp (kiểu 9Router). Tách khỏi `ai/index.vue` — đây là tab lớn nhất
 * (1017 dòng script + 510 dòng template + 5 modal).
 *
 * Phụ thuộc chéo: là source of `providers` + `pricingRows` cho Services tab + Logs
 * tab (filter). Cha giữ hai ref này và truyền prop xuống 2 tab kia. Khi test-call
 * hoặc sync Delify làm thay đổi usage/logs, emit `invalidate` lên cha để cha
 * forward xuống Dashboard.loadUsage + Logs.clearLogs.
 */
import { errorMessage } from '~/utils/errorMessage'
import { PROVIDER_PRESETS, formatVnd, type ProviderRow, type PricingRow } from '~/utils/ai-service-labels'

const emit = defineEmits<{ invalidate: [] }>()

const toast = useToast()
const { confirm } = useConfirm()

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
    const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; deleted: number }>)('/api/admin/ai/providers/bulk-delete', {
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
    const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; deleted: number }>)('/api/admin/ai/pricing/bulk-delete', {
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
      ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ providers: ProviderRow[] }>)('/api/admin/ai/providers'),
      ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ pricing: PricingRow[] }>)('/api/admin/ai/pricing'),
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
    const data = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ pricing: PricingRow[] }>)('/api/admin/ai/pricing')
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
    await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)(`/api/admin/ai/providers/${editingProvider.value.id}`, {
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
    const result = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; model?: string; error?: string }>)(`/api/admin/ai/providers/${id}/test`, {
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
    await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)('/api/admin/ai/providers', {
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
    await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)(`/api/admin/ai/providers/${p.id}`, { method: 'DELETE' })
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
    await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)(`/api/admin/ai/pricing/${encodeURIComponent(m.model)}`, {
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
    await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)('/api/admin/ai/pricing', {
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
    await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)(`/api/admin/ai/pricing/${encodeURIComponent(editingModel.value.model)}`, {
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
    await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)(`/api/admin/ai/pricing/${encodeURIComponent(m.model)}`, { method: 'DELETE' })
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
    const result = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{
      ok: boolean
      model?: string
      reply?: string
      durationMs?: number
      usage?: { promptTokens: number; completionTokens: number; totalTokens: number }
      costVnd?: number
      error?: string
    }>)('/api/admin/ai/test-call', {
      method: 'POST',
      body: {
        provider,
        model,
        serviceKey: 'test_call',
        message: 'Xin chào! Hãy phản hồi ngắn gọn 1 câu để kiểm tra kết nối.',
        maxTokens: 100,
      },
    })
    emit('invalidate')
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
    const result = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{
      ok: boolean
      upserted: number
      syncedLogs: number
      totalFromApi: number
      delifyUsage: { windowCostUsd: number | null; windowRequests: number | null; allowedModels: string[] | null } | null
    }>)('/api/admin/ai/delify/sync', {
      method: 'POST',
    })
    if (result.delifyUsage) {
      delifyUsage.value = result.delifyUsage
    }
    const logMsg = result.syncedLogs > 0 ? ` và ${result.syncedLogs} cuộc gọi` : ''
    toast.success(`Đã đồng bộ ${result.upserted} model${logMsg} từ Delify Router.`)
    await loadProviders()
    emit('invalidate')
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

// Tự fetch khi mount — không phụ thuộc watch(activeTab) ở cha (ref assign sau patch).
onMounted(() => { void loadProviders() })

// Cha truyền prop providers + pricingRows xuống Services/Logs; cha cũng cần load
// wire — expose loadProviders + providers/pricingRows getter cho cha.
defineExpose<{
  loadProviders: typeof loadProviders
  providers: typeof providers
  pricingRows: typeof pricingRows
}>({
  loadProviders,
  providers,
  pricingRows,
})
</script>

<template>
  <div class="flex flex-col gap-5">
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
</template>
