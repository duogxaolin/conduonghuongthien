<script setup lang="ts">
/**
 * The models of one provider in the "Nhà cung cấp & Models" tab: counts, the Delify sync
 * and "Thêm Model" buttons, the bar for the ticked models of THIS provider, the empty state
 * and the price table (switch, prices, estimated cost of one call, Test / Sửa giá / Xoá).
 * Display only — props in, events out; the tab owns the selection and every request.
 */
import { formatVnd, type PricingRow, type ProviderRow } from '~/utils/ai-service-labels'

defineProps<{
  provider: ProviderRow
  /** This provider's models. */
  models: PricingRow[]
  /** Every ticked model key (of all providers); this panel reads its own rows only, never writes. */
  selectedModels: Set<string>
  /** Every model of this provider is ticked. */
  allSelected: boolean
  syncingDelify: boolean
  deletingBulkModels: boolean
  /** Model whose test call is in flight. */
  testingModel: string | null
}>()

defineEmits<{
  syncDelify: []
  addModel: []
  clearSelection: []
  bulkDelete: []
  toggleAll: []
  toggleModel: [model: string]
  toggleActive: [m: PricingRow]
  testModel: [model: string]
  editModel: [m: PricingRow]
  deleteModel: [m: PricingRow]
}>()

/** Cost of a typical call (1000 tokens in, 500 out) at the USD/VND rate the tab has always used. */
function estimatedCostVnd(promptPerM: number, compPerM: number): string {
  const usd = (1000 * promptPerM + 500 * compPerM) / 1_000_000
  const vnd = usd * 25500
  return formatVnd(vnd)
}
</script>

<template>
  <div class="p-4 sm:p-5 flex flex-col gap-3">
    <!-- Models Sub-Header -->
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <span class="text-xs font-bold text-brand-950 uppercase tracking-wide">
          Danh sách Models của {{ provider.label }}
        </span>
        <span class="text-xs text-ink-muted">
          ({{ models.length }} models, {{ models.filter(m => m.isActive).length }} đang bật)
        </span>
      </div>

      <div class="flex items-center gap-2">
        <!-- Delify Router Instant Sync Button -->
        <button
          v-if="provider.provider === 'delify'"
          type="button"
          class="px-3 py-1.5 rounded-lg border border-brand-700 bg-surface-tint text-xs font-bold text-brand-700 hover:bg-[#e4f0e2]"
          :disabled="syncingDelify"
          @click="$emit('syncDelify')"
        >
          <i class="fa-solid fa-rotate mr-1" aria-hidden="true"></i>
          {{ syncingDelify ? 'Đang đồng bộ...' : '⚡ Tải model & giá từ Delify API' }}
        </button>

        <!-- Add Model to this provider -->
        <button
          type="button"
          class="px-3 py-1.5 rounded-lg border border-line-strong bg-white text-xs font-semibold text-brand-950 hover:bg-surface-tint"
          @click="$emit('addModel')"
        >
          <i class="fa-solid fa-plus mr-1" aria-hidden="true"></i> Thêm Model
        </button>
      </div>
    </div>
    <!-- Model Bulk Action Bar -->
    <div
      v-if="models.some(m => selectedModels.has(m.model))"
      class="rounded-lg border border-red-200 bg-red-50/90 p-2.5 flex flex-wrap items-center justify-between gap-2"
    >
      <span class="text-xs font-bold text-[#a32924]">
        Đã chọn <strong>{{ models.filter(m => selectedModels.has(m.model)).length }}</strong> model của {{ provider.label }}
      </span>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="px-2.5 py-1 rounded border border-line-strong bg-white text-xs font-semibold text-ink-muted hover:bg-surface"
          @click="$emit('clearSelection')"
        >
          Bỏ chọn
        </button>
        <button
          type="button"
          class="px-3 py-1 rounded bg-danger text-white text-xs font-bold hover:bg-[#b01e1a] shadow-sm transition-colors"
          :disabled="deletingBulkModels"
          @click="$emit('bulkDelete')"
        >
          <i class="fa-solid fa-trash mr-1" aria-hidden="true"></i>
          {{ deletingBulkModels ? 'Đang xoá...' : `Xoá ${models.filter(m => selectedModels.has(m.model)).length} model đã chọn` }}
        </button>
      </div>
    </div>

    <!-- Models Table -->
    <div v-if="models.length === 0" class="rounded-lg border border-dashed border-line-strong p-6 text-center text-xs text-ink-muted">
      Chưa có model nào cho nhà cung cấp này.
      <template v-if="provider.provider === 'delify'">
        Bấm nút <strong>"⚡ Tải model & giá từ Delify API"</strong> ở trên để nạp tự động toàn bộ model của Delify!
      </template>
      <template v-else>
        Bấm <strong>"Thêm Model"</strong> để cấu hình model đầu tiên.
      </template>
    </div>

    <div v-else class="rounded-lg border border-line overflow-x-auto">
      <table class="w-full text-xs">
        <thead class="bg-surface text-left">
          <tr>
            <th class="px-2.5 py-2 w-8 text-center">
              <input
                type="checkbox"
                class="w-3.5 h-3.5 accent-brand-700 rounded cursor-pointer"
                :checked="allSelected"
                title="Chọn tất cả model của nhà cung cấp này"
                @change="$emit('toggleAll')"
              />
            </th>
            <th class="px-3 py-2 font-bold text-brand-950">Trạng thái</th>
            <th class="px-3 py-2 font-bold text-brand-950">Mã Model (API)</th>
            <th class="px-3 py-2 font-bold text-brand-950">Tên hiển thị</th>
            <th class="px-3 py-2 font-bold text-brand-950 text-right">Giá Input ($/1M)</th>
            <th class="px-3 py-2 font-bold text-brand-950 text-right">Giá Output ($/1M)</th>
            <th class="px-3 py-2 font-bold text-brand-950 text-right">Ước tính / call</th>
            <th class="px-3 py-2 font-bold text-brand-950 text-center">Thao tác</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="m in models"
            :key="m.model"
            class="border-t border-line hover:bg-surface transition-colors"
            :class="!m.isActive ? 'opacity-50 bg-[#fafafa]' : ''"
          >
            <td class="px-2.5 py-2 text-center">
              <input
                type="checkbox"
                class="w-3.5 h-3.5 accent-brand-700 rounded cursor-pointer"
                :checked="selectedModels.has(m.model)"
                @change="$emit('toggleModel', m.model)"
              />
            </td>
            <!-- 9Router style toggle switch -->
            <td class="px-3 py-2">
              <button
                type="button"
                class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none"
                :class="m.isActive ? 'bg-brand-700' : 'bg-gray-300'"
                :title="m.isActive ? 'Bấm để tắt model này' : 'Bấm để bật model này'"
                @click="$emit('toggleActive', m)"
              >
                <span
                  aria-hidden="true"
                  class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                  :class="m.isActive ? 'translate-x-4' : 'translate-x-0'"
                ></span>
              </button>
            </td>
            <td class="px-3 py-2 font-mono font-bold text-brand-950">{{ m.model }}</td>
            <td class="px-3 py-2 text-ink-muted">{{ m.label ?? '—' }}</td>
            <td class="px-3 py-2 text-right font-mono text-brand-700">${{ m.promptCostPerMillion }}</td>
            <td class="px-3 py-2 text-right font-mono text-brand-700">${{ m.completionCostPerMillion }}</td>
            <td class="px-3 py-2 text-right text-ink-muted font-mono">
              {{ estimatedCostVnd(m.promptCostPerMillion, m.completionCostPerMillion) }}
            </td>
            <td class="px-3 py-2 text-center whitespace-nowrap">
              <button
                type="button"
                class="px-2 py-0.5 rounded border border-line-strong bg-white text-xs font-bold text-brand-700 hover:bg-surface-tint mr-2 transition-colors inline-flex items-center gap-1"
                :disabled="testingModel === m.model"
                title="Gọi thử nghiệm model này (Xin chào...)"
                @click="$emit('testModel', m.model)"
              >
                <i class="fa-solid fa-bolt text-[0.65rem]" aria-hidden="true"></i>
                {{ testingModel === m.model ? 'Đang gọi...' : 'Test' }}
              </button>
              <button type="button" class="text-brand-700 font-semibold hover:underline mr-2" @click="$emit('editModel', m)">
                Sửa giá
              </button>
              <button type="button" class="text-danger font-semibold hover:underline" @click="$emit('deleteModel', m)">
                Xoá
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
