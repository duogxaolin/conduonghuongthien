import { ref, type Ref } from 'vue'

// Relative paths, not `~/`: tests import this file directly, and the test loader
// (scripts/ts-resolver.mjs) only knows `~~/`.
import { adminFetch } from './adminFetch'
import { errorMessage } from '../utils/errorMessage'
import { PROVIDER_PRESETS, type ProviderRow } from '../utils/ai-service-labels'
import type { useConfirm } from './useConfirm'
import type { useToast } from './useToast'

/**
 * Provider side of the "Nhà cung cấp & Models" tab (`components/admin/ai/AiProvidersTab.vue`):
 * add / edit (Base URL, API key) / delete / bulk delete a provider, and "Test kết nối".
 * Moved out of the tab when it was split (wave3 4.2); the tab keeps the list, its load
 * (`loadProviders`, handed in as `reload`) and the load/error/retry contract.
 *
 * `toast` and `confirm` are the tab's own (`useToast()`/`useConfirm()`), handed in rather
 * than called here, so this file needs no Nuxt auto-import and runs as is under the tests.
 *
 * The API key typed in a form goes out once, in the request body; the server answers only
 * its last four characters (`apiKeyLastFour`). Changing the Base URL of a provider that holds
 * a key without typing the key again is refused by the server
 * (`server/api/admin/ai/providers/[id].put.ts`) — the refusal lands in a toast and the dialog
 * stays open with the form as typed.
 */
export interface AiProviderWritesDeps {
  toast: Pick<ReturnType<typeof useToast>, 'success' | 'error'>
  confirm: ReturnType<typeof useConfirm>['confirm']
  providers: Ref<ProviderRow[]>
  /** Re-read both lists (the tab's `loadProviders`). */
  reload: () => Promise<void>
}

export type ProviderForm = { label: string; baseUrl: string; isActive: boolean; apiKey: string }
export type NewProviderForm = { provider: string; label: string; baseUrl: string; isActive: boolean; apiKey: string }

export function useAiProviderWrites({ toast, confirm, providers, reload }: AiProviderWritesDeps) {
  // Provider Edit modal
  const editingProvider = ref<ProviderRow | null>(null)
  const providerForm = ref<ProviderForm>({ label: '', baseUrl: '', isActive: false, apiKey: '' })
  const savingProvider = ref(false)
  // "Test kết nối" — one probe at a time is shown: the latest one. `testingProvider` is the
  // provider whose probe is in flight, `testResultFor` the provider `testResult` belongs to;
  // the card and the settings dialog show a result only for their own provider.
  const testingProvider = ref<number | null>(null)
  const testResult = ref<string | null>(null)
  const testResultFor = ref<number | null>(null)
  let latestProbe = 0

  // Create provider modal
  const showCreateForm = ref(false)
  const newProviderForm = ref<NewProviderForm>({ provider: 'delify', label: 'Delify Router', baseUrl: 'https://router.delify.vn/v1', isActive: true, apiKey: '' })
  const newProviderError = ref('')
  const savingNewProvider = ref(false)

  // Delete provider
  const deletingProviderId = ref<number | null>(null)

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
      const res = await adminFetch<{ ok: true; deleted: number }>('/api/admin/ai/providers/bulk-delete', {
        method: 'POST',
        body: { ids },
      })
      toast.success(`Đã xoá ${res.deleted} nhà cung cấp.`)
      selectedProviderIds.value.clear()
      await reload()
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Không thể xoá nhà cung cấp.'))
    } finally {
      deletingBulkProviders.value = false
    }
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
      await adminFetch<{ ok: true; message?: string }>(`/api/admin/ai/providers/${editingProvider.value.id}`, {
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
      await reload()
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Không thể lưu nhà cung cấp.'))
    } finally {
      savingProvider.value = false
    }
  }

  async function testProvider(id: number) {
    const probe = ++latestProbe
    testingProvider.value = id
    testResultFor.value = id
    testResult.value = null
    let outcome: string
    try {
      const result = await adminFetch<{ ok: true; model?: string } | { ok: false; error: string }>(`/api/admin/ai/providers/${id}/test`, {
        method: 'POST',
      })
      if (result.ok) {
        outcome = result.model ? `Kết nối thành công (model: ${result.model})` : 'Kết nối thành công.'
      } else {
        outcome = `Thất bại: ${result.error ?? 'lỗi không rõ'}`
      }
    } catch (err: unknown) {
      outcome = `Thất bại: ${errorMessage(err, 'lỗi kết nối')}`
    }
    // Overtaken by a newer probe (another card): that one owns the result and the
    // "Đang test..." mark — this answer must not end it, nor show under its provider.
    if (probe !== latestProbe) return
    testResult.value = outcome
    testingProvider.value = null
  }

  /** The reload brought the list back: forget ticks on providers that are gone. */
  function forgetMissingProviders() {
    for (const id of [...selectedProviderIds.value]) {
      if (!providers.value.some(p => p.id === id)) selectedProviderIds.value.delete(id)
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
      await adminFetch<{ ok: true; id?: number }>('/api/admin/ai/providers', {
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
      await reload()
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
      await adminFetch<{ ok: true }>(`/api/admin/ai/providers/${p.id}`, { method: 'DELETE' })
      toast.success('Đã xoá nhà cung cấp.')
      await reload()
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Không thể xoá nhà cung cấp.'))
    } finally {
      deletingProviderId.value = null
    }
  }

  return {
    editingProvider, providerForm, savingProvider, testingProvider, testResult, testResultFor,
    showCreateForm, newProviderForm, newProviderError, savingNewProvider,
    deletingProviderId, selectedProviderIds, deletingBulkProviders,
    toggleSelectProvider, selectAllProviders, bulkDeleteProviders, forgetMissingProviders,
    openProviderEdit, saveProvider, testProvider,
    openCreateProvider, onNewProviderPresetChange, createProvider, deleteProvider,
  }
}
