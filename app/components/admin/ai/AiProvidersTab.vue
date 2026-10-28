<script setup lang="ts">
/**
 * Providers & Models tab của AI Panel — Quản lý API key, kết nối, model + giá cho
 * từng nhà cung cấp (kiểu 9Router). Tách khỏi `ai/index.vue`.
 *
 * Phụ thuộc chéo: là source of `providers` + `pricingRows` cho Services tab + Logs
 * tab (filter). Cha giữ hai ref này và truyền prop xuống 2 tab kia. Khi test-call
 * hoặc sync Delify làm thay đổi usage/logs, emit `invalidate` lên cha để cha
 * forward xuống Dashboard.loadUsage + Logs.clearLogs.
 *
 * Tách (wave3 4.2, docs/decisions/refactor-large-files.md): tệp này giữ hai danh sách,
 * lượt tải `loadProviders` + nhánh lỗi `role="alert"` + "Thử lại" + khung chờ (ghim bởi
 * tests/admin-error-retry-ui.test.ts và skeleton-loading-ui.test.ts), thanh chọn nhiều nhà
 * cung cấp, trạng thái gập của từng thẻ và `defineExpose`. Thao tác ghi + trạng thái của
 * chúng ở `useAiProviderWrites`/`useAiModelWrites`; phần hiển thị ở `./providers/*.vue`
 * (props vào, sự kiện ra — không phần nào tự gọi API).
 */
import type { ProviderRow, PricingRow } from '~/utils/ai-service-labels'
import { errorMessage } from '~/utils/errorMessage'
import { useAiProviderWrites } from '~/composables/useAiProviderWrites'
import { useAiModelWrites } from '~/composables/useAiModelWrites'
import ProviderCardHeader from '~/components/admin/ai/providers/ProviderCardHeader.vue'
import ProviderModelsPanel from '~/components/admin/ai/providers/ProviderModelsPanel.vue'
import ProviderCreateModal from '~/components/admin/ai/providers/ProviderCreateModal.vue'
import ProviderEditModal from '~/components/admin/ai/providers/ProviderEditModal.vue'
import ModelAddModal from '~/components/admin/ai/providers/ModelAddModal.vue'
import ModelEditModal from '~/components/admin/ai/providers/ModelEditModal.vue'
import ModelTestCallModal from '~/components/admin/ai/providers/ModelTestCallModal.vue'

const emit = defineEmits<{ invalidate: [] }>()

const toast = useToast()
const { confirm } = useConfirm()

const providersError = ref(null as string | null)
const providersLoading = ref(false)
const providers = ref<ProviderRow[]>([])
const pricingRows = ref<PricingRow[]>([])

// Accordion open/close per provider (all open by default: no entry = open)
const openProviderPanels = ref<Record<string, boolean>>({})

function toggleProviderPanel(providerName: string) {
  openProviderPanels.value[providerName] = !isProviderPanelOpen(providerName)
}

function isProviderPanelOpen(providerName: string): boolean {
  return openProviderPanels.value[providerName] !== false
}

const {
  editingProvider, providerForm, savingProvider, testingProvider, testResult, testResultFor,
  showCreateForm, newProviderForm, newProviderError, savingNewProvider,
  deletingProviderId, selectedProviderIds, deletingBulkProviders,
  toggleSelectProvider, selectAllProviders, bulkDeleteProviders, forgetMissingProviders,
  openProviderEdit, saveProvider, testProvider,
  openCreateProvider, onNewProviderPresetChange, createProvider, deleteProvider,
} = useAiProviderWrites({ toast, confirm, providers, reload: () => loadProviders() })

const {
  modelsForProvider,
  selectedModelKeys, deletingBulkModels,
  isModelSelected, toggleSelectModel, isAllModelsSelectedForProvider, toggleSelectAllModelsForProvider, bulkDeleteModels,
  forgetMissingModels,
  toggleModelActive,
  showAddModelModal, targetProviderForModel, newModelForm, newModelError, savingNewModel, openAddModel, addModelToProvider,
  editingModel, editModelForm, savingModelEdit, openEditModel, saveEditModel, deleteModel,
  testingModelKey, modelTestModal, testCallModel,
  syncingDelify, delifyUsage, syncDelifyPricing,
} = useAiModelWrites({ toast, confirm, pricingRows, reload: () => loadProviders(), onInvalidate: () => emit('invalidate') })

async function loadProviders() {
  providersError.value = null
  providersLoading.value = true
  try {
    const [pData, prData] = await Promise.all([
      adminFetch<{ ok: true; providers: ProviderRow[] }>('/api/admin/ai/providers'),
      adminFetch<{ ok: true; pricing: PricingRow[] }>('/api/admin/ai/pricing'),
    ])
    providers.value = pData.providers
    pricingRows.value = prData.pricing
    // A row deleted (one by one, by a bulk delete, by the Delify sync) must not stay ticked.
    forgetMissingProviders()
    forgetMissingModels()
  } catch (err: unknown) {
    providersError.value = errorMessage(err, 'Không thể tải danh sách nhà cung cấp.')
  } finally {
    providersLoading.value = false
  }
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
      <button type="button" class="font-bold underline text-brand-600 ml-2" @click="loadProviders()">Thử lại</button>
    </div>

    <div v-if="providersLoading" class="flex items-center justify-center py-12" role="status" aria-busy="true">
      <span class="sr-only">Đang tải danh sách nhà cung cấp</span>
      <div class="flex gap-1.5" aria-hidden="true">
        <span class="w-2.5 h-2.5 rounded-full bg-brand-700 animate-pulse motion-reduce:animate-none"></span>
        <span class="w-2.5 h-2.5 rounded-full bg-brand-700 animate-pulse motion-reduce:animate-none" style="animation-delay: 0.15s"></span>
        <span class="w-2.5 h-2.5 rounded-full bg-brand-700 animate-pulse motion-reduce:animate-none" style="animation-delay: 0.3s"></span>
      </div>
    </div>

    <template v-if="!providersLoading && !providersError">
      <!-- Header action bar -->
      <div class="flex flex-wrap items-center justify-between gap-3">
        <p class="m-0 text-sm text-ink-muted">
          Quản lý API Key, kết nối và cấu hình từng model được phép dùng cho mỗi Nhà cung cấp.
        </p>
        <button type="button" class="px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-semibold hover:bg-brand-900" @click="openCreateProvider()">
          <i class="fa-solid fa-plus mr-1.5" aria-hidden="true"></i> Thêm nhà cung cấp
        </button>
      </div>

      <!-- Provider Bulk Action Bar -->
      <div v-if="selectedProviderIds.size > 0" class="rounded-xl border border-red-200 bg-red-50/80 p-3.5 flex flex-wrap items-center justify-between gap-3 shadow-sm">
        <div class="flex items-center gap-2">
          <i class="fa-solid fa-circle-check text-danger" aria-hidden="true"></i>
          <span class="text-xs font-bold text-[#a32924]">
            Đã chọn <strong>{{ selectedProviderIds.size }}</strong> nhà cung cấp
          </span>
        </div>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="px-3 py-1.5 rounded-lg border border-line-strong bg-white text-xs font-semibold text-ink-muted hover:bg-surface"
            @click="selectedProviderIds.clear()"
          >
            Bỏ chọn
          </button>
          <button
            type="button"
            class="px-3.5 py-1.5 rounded-lg bg-danger text-white text-xs font-bold hover:bg-[#b01e1a] shadow-sm transition-colors"
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
          class="rounded-xl border border-line bg-white overflow-hidden shadow-sm transition-all"
        >
          <ProviderCardHeader
            :provider="p"
            :selected="selectedProviderIds.has(p.id)"
            :testing="testingProvider === p.id"
            :test-result="testResultFor === p.id ? testResult : null"
            :deleting="deletingProviderId === p.id"
            :open="isProviderPanelOpen(p.provider)"
            @toggle-select="toggleSelectProvider(p.id)"
            @test="testProvider(p.id)"
            @edit="openProviderEdit(p)"
            @delete="deleteProvider(p)"
            @toggle-panel="toggleProviderPanel(p.provider)"
          />
          <!-- Provider Models Section (Expandable 9Router style) -->
          <ProviderModelsPanel
            v-show="isProviderPanelOpen(p.provider)"
            :provider="p"
            :models="modelsForProvider(p.provider)"
            :selected-models="selectedModelKeys"
            :all-selected="isAllModelsSelectedForProvider(p.provider)"
            :syncing-delify="syncingDelify"
            :deleting-bulk-models="deletingBulkModels"
            :testing-model="testingModelKey"
            @sync-delify="syncDelifyPricing()"
            @add-model="openAddModel(p.provider)"
            @clear-selection="modelsForProvider(p.provider).forEach(m => selectedModelKeys.delete(m.model))"
            @bulk-delete="bulkDeleteModels(p.provider)"
            @toggle-all="toggleSelectAllModelsForProvider(p.provider)"
            @toggle-model="toggleSelectModel"
            @toggle-active="toggleModelActive"
            @test-model="model => testCallModel(p.provider, model)"
            @edit-model="openEditModel"
            @delete-model="deleteModel"
          />
        </div>
      </div>

      <!-- ── Modals ────────────────────────────────────────────────── -->
      <ProviderCreateModal
        v-model:form="newProviderForm"
        :open="showCreateForm"
        :busy="savingNewProvider"
        :error="newProviderError"
        @close="showCreateForm = false"
        @preset-change="onNewProviderPresetChange()"
        @submit="createProvider()"
      />
      <ProviderEditModal
        v-model:form="providerForm"
        :provider="editingProvider"
        :busy="savingProvider"
        :testing="!!testingProvider"
        :test-result="editingProvider && testResultFor === editingProvider.id ? testResult : null"
        @close="editingProvider = null"
        @test="testProvider"
        @save="saveProvider()"
      />
      <ModelAddModal
        v-model:form="newModelForm"
        :open="showAddModelModal"
        :provider-name="targetProviderForModel"
        :busy="savingNewModel"
        :error="newModelError"
        @close="showAddModelModal = false"
        @submit="addModelToProvider()"
      />
      <ModelEditModal
        v-model:form="editModelForm"
        :model="editingModel"
        :busy="savingModelEdit"
        @close="editingModel = null"
        @save="saveEditModel()"
      />
      <ModelTestCallModal :result="modelTestModal" @close="modelTestModal = null" />
    </template>
  </div>
</template>
