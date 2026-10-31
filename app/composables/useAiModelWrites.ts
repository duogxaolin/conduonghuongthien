import { ref, type Ref } from 'vue'

// Relative paths, not `~/`: tests import this file directly, and the test loader
// (scripts/ts-resolver.mjs) only knows `~~/`.
import { adminFetch } from './adminFetch'
import { errorMessage } from '../utils/errorMessage'
import type { PricingRow } from '../utils/ai-service-labels'
import type { useConfirm } from './useConfirm'
import type { useToast } from './useToast'

/**
 * Model side of the "Nhà cung cấp & Models" tab (`components/admin/ai/AiProvidersTab.vue`):
 * the model selection and bulk delete, the on/off switch (optimistic), add / edit price /
 * delete a model, the test call of one model and the Delify price sync. Moved out of the
 * tab when it was split (wave3 4.2); the tab keeps the list and its load (`reload`).
 *
 * `toast` and `confirm` are the tab's own, handed in (as in `useAiProviderWrites`).
 * `onInvalidate` is the tab's `emit('invalidate')`: a test call or a sync writes usage and
 * logs, which `ai/index.vue` forwards to the Dashboard and Logs tabs.
 */
export interface AiModelWritesDeps {
  toast: Pick<ReturnType<typeof useToast>, 'success' | 'error'>
  confirm: ReturnType<typeof useConfirm>['confirm']
  pricingRows: Ref<PricingRow[]>
  /** Re-read both lists (the tab's `loadProviders`). */
  reload: () => Promise<void>
  onInvalidate: () => void
}

export type NewModelForm = { model: string; label: string; promptCostPerMillion: number; completionCostPerMillion: number; isActive: boolean }
export type EditModelForm = { label: string; promptCostPerMillion: number; completionCostPerMillion: number; isActive: boolean }
/** What the "Test Call" dialog shows: the answer of `POST /api/admin/ai/test-call`, or why it failed. */
export type ModelTestResult = {
  model: string
  provider: string
  reply: string
  durationMs: number
  usage: { promptTokens: number; completionTokens: number; totalTokens: number }
  costVnd: number
  error: string | null
}
// Shape of `delifyUsage` in server/api/admin/ai/delify/sync.post.ts.
type DelifyUsage = { windowCostUsd: number | null; windowRequests: number | null; allowedModels: string[] | null }

export function useAiModelWrites({ toast, confirm, pricingRows, reload, onInvalidate }: AiModelWritesDeps) {
  // Filter models for a specific provider
  function modelsForProvider(providerName: string): PricingRow[] {
    return pricingRows.value.filter(m => m.provider === providerName)
  }

  // Add model to provider modal
  const showAddModelModal = ref(false)
  const targetProviderForModel = ref<string>('')
  const newModelForm = ref<NewModelForm>({ model: '', label: '', promptCostPerMillion: 1.0, completionCostPerMillion: 4.0, isActive: true })
  const newModelError = ref('')
  const savingNewModel = ref(false)

  // Edit model modal
  const editingModel = ref<PricingRow | null>(null)
  const editModelForm = ref<EditModelForm>({ label: '', promptCostPerMillion: 0, completionCostPerMillion: 0, isActive: true })
  const savingModelEdit = ref(false)

  // Delify sync state
  const syncingDelify = ref(false)
  const delifyUsage = ref<DelifyUsage | null>(null)

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

  /**
   * The bar sits in ONE provider's panel and counts that provider's ticks, so it deletes
   * those — the ticks under other providers stay for their own bar.
   */
  async function bulkDeleteModels(providerName: string) {
    const own = new Set(modelsForProvider(providerName).map(m => m.model))
    const models = Array.from(selectedModelKeys.value).filter(model => own.has(model))
    if (models.length === 0) return
    if (!await confirm({
      title: 'Xoá nhiều Model',
      message: `Bạn có chắc muốn xoá ${models.length} model đã chọn?`,
      danger: true,
      confirmLabel: `Xoá ${models.length} model`,
    })) return

    deletingBulkModels.value = true
    try {
      const res = await adminFetch<{ ok: true; deleted: number }>('/api/admin/ai/pricing/bulk-delete', {
        method: 'POST',
        body: { models },
      })
      toast.success(`Đã xoá ${res.deleted} model.`)
      for (const model of models) selectedModelKeys.value.delete(model)
      await reload()
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Không thể xoá models.'))
    } finally {
      deletingBulkModels.value = false
    }
  }

  /** The reload brought the list back: forget ticks on models that are gone (a re-added one starts unticked). */
  function forgetMissingModels() {
    for (const model of [...selectedModelKeys.value]) {
      if (!pricingRows.value.some(m => m.model === model)) selectedModelKeys.value.delete(model)
    }
  }

  // ── Model actions ─────────────────────────────────────────────────────

  // Toggle model active status (optimistic update like 9Router)
  async function toggleModelActive(m: PricingRow) {
    const original = m.isActive
    m.isActive = !original
    try {
      await adminFetch<{ ok: true; message?: string }>(`/api/admin/ai/pricing/${encodeURIComponent(m.model)}`, {
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
      await adminFetch<{ ok: true }>('/api/admin/ai/pricing', {
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
      await reload()
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
      await adminFetch<{ ok: true; message?: string }>(`/api/admin/ai/pricing/${encodeURIComponent(editingModel.value.model)}`, {
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
      await reload()
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Không thể lưu model.'))
    } finally {
      savingModelEdit.value = false
    }
  }

  async function deleteModel(m: PricingRow) {
    if (!await confirm({ title: 'Xoá Model', message: `Xoá model "${m.model}" khỏi ${m.provider}?`, danger: true, confirmLabel: 'Xoá' })) return
    try {
      await adminFetch<{ ok: true }>(`/api/admin/ai/pricing/${encodeURIComponent(m.model)}`, { method: 'DELETE' })
      toast.success(`Đã xoá model "${m.model}".`)
      await reload()
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Không thể xoá model.'))
    }
  }

  // ── Test call model directly (9Router style) ──────────────────────────
  const testingModelKey = ref<string | null>(null)
  const modelTestModal = ref<ModelTestResult | null>(null)

  async function testCallModel(provider: string, model: string) {
    testingModelKey.value = model
    try {
      // server/api/admin/ai/test-call.post.ts: a failed call answers 200 `{ ok: false, error }`.
      const result = await adminFetch<{
        ok: true; model: string; provider: string; reply: string; durationMs: number
        usage: { promptTokens: number; completionTokens: number; totalTokens: number }; costVnd: number
      } | { ok: false; model?: string; durationMs?: number; error: string }>('/api/admin/ai/test-call', {
        method: 'POST',
        body: {
          provider,
          model,
          serviceKey: 'test_call',
          message: 'Xin chào! Hãy phản hồi ngắn gọn 1 câu để kiểm tra kết nối.',
          maxTokens: 100,
        },
      })
      onInvalidate()
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
      const result = await adminFetch<{
        ok: true; upserted: number; skipped: number; totalFromApi: number; delifyUsage: DelifyUsage | null
      }>('/api/admin/ai/delify/sync', {
        method: 'POST',
      })
      if (result.delifyUsage) {
        delifyUsage.value = result.delifyUsage
      }
      // Giá model thôi: lịch sử cuộc gọi của router không còn ghi vào nhật ký AI (mỗi
      // cuộc gọi đã có hàng do cổng AI ghi — nhập lại là đếm hai lần).
      toast.success(`Đã đồng bộ giá ${result.upserted} model từ Delify Router.`)
      await reload()
      onInvalidate()
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Không thể đồng bộ từ Delify.'))
    } finally {
      syncingDelify.value = false
    }
  }

  return {
    modelsForProvider,
    selectedModelKeys, deletingBulkModels,
    isModelSelected, toggleSelectModel, isAllModelsSelectedForProvider, toggleSelectAllModelsForProvider, bulkDeleteModels,
    forgetMissingModels,
    toggleModelActive,
    showAddModelModal, targetProviderForModel, newModelForm, newModelError, savingNewModel, openAddModel, addModelToProvider,
    editingModel, editModelForm, savingModelEdit, openEditModel, saveEditModel, deleteModel,
    testingModelKey, modelTestModal, testCallModel,
    syncingDelify, delifyUsage, syncDelifyPricing,
  }
}
