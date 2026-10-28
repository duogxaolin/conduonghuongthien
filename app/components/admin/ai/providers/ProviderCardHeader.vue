<script setup lang="ts">
/**
 * Header of one provider card in the "Nhà cung cấp & Models" tab: the select box, icon,
 * label, state, Base URL, the API key as `••••` + the last four characters the server sends
 * (never the key), the four actions and the "Test kết nối" result. Display only — props in,
 * events out; the tab (`AiProvidersTab.vue`) owns the state and every request.
 */
import type { ProviderRow } from '~/utils/ai-service-labels'

defineProps<{
  provider: ProviderRow
  /** Ticked for the bulk delete. */
  selected: boolean
  /** "Test kết nối" of this provider is in flight. */
  testing: boolean
  /** The "Test kết nối" result to show on this card, or null. */
  testResult: string | null
  deleting: boolean
  /** The models panel below is open. */
  open: boolean
}>()

defineEmits<{ toggleSelect: [], test: [], edit: [], delete: [], togglePanel: [] }>()
</script>

<template>
  <div class="p-4 sm:p-5 flex flex-col gap-3 border-b border-line bg-surface">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <!-- Checkbox to select provider -->
        <label class="flex items-center cursor-pointer p-0.5" title="Chọn nhà cung cấp này để xoá">
          <input
            type="checkbox"
            class="w-4 h-4 accent-brand-700 rounded cursor-pointer"
            :checked="selected"
            @change="$emit('toggleSelect')"
          />
        </label>
        <!-- Provider Icon -->
        <div class="w-10 h-10 rounded-xl bg-[#e4f0e2] text-brand-700 flex items-center justify-center text-lg font-bold">
          <i v-if="provider.provider === 'delify'" class="fa-solid fa-bolt" aria-hidden="true"></i>
          <i v-else-if="provider.provider === 'google'" class="fa-brands fa-google" aria-hidden="true"></i>
          <i v-else-if="provider.provider === 'openai'" class="fa-solid fa-brain" aria-hidden="true"></i>
          <i v-else-if="provider.provider === 'anthropic'" class="fa-solid fa-robot" aria-hidden="true"></i>
          <i v-else class="fa-solid fa-server" aria-hidden="true"></i>
        </div>
        <div>
          <div class="flex items-center gap-2">
            <h2 class="m-0 text-base font-extrabold text-brand-950">{{ provider.label }}</h2>
            <span class="text-xs font-mono text-ink-muted bg-surface px-2 py-0.5 rounded">({{ provider.provider }})</span>
            <span
              class="px-2 py-0.5 rounded-full text-xs font-semibold"
              :class="provider.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'"
            >
              {{ provider.isActive ? 'Hoạt động' : 'Tắt' }}
            </span>
          </div>
          <p class="m-0 mt-0.5 text-xs text-ink-muted flex items-center gap-2 flex-wrap">
            <span>Base URL: <code class="text-brand-700">{{ provider.baseUrl ?? 'Chưa cấu hình' }}</code></span>
            <span>•</span>
            <span>API Key: <code>{{ provider.apiKeyLastFour ? '••••' + provider.apiKeyLastFour : 'Chưa nhập' }}</code></span>
          </p>
        </div>
      </div>

      <!-- Provider Actions -->
      <div class="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          class="px-3 py-1.5 rounded-lg border border-line-strong bg-white text-xs font-semibold text-brand-950 hover:bg-surface-tint"
          :disabled="testing"
          @click="$emit('test')"
        >
          <i class="fa-solid fa-vial mr-1" aria-hidden="true"></i>
          {{ testing ? 'Đang test...' : 'Test kết nối' }}
        </button>
        <button
          type="button"
          class="px-3 py-1.5 rounded-lg border border-line-strong bg-white text-xs font-semibold text-brand-950 hover:bg-surface-tint"
          @click="$emit('edit')"
        >
          <i class="fa-solid fa-gear mr-1" aria-hidden="true"></i> Cài đặt
        </button>
        <button
          type="button"
          class="px-2.5 py-1.5 rounded-lg border border-transparent text-xs font-semibold text-danger hover:bg-red-50"
          :disabled="deleting"
          @click="$emit('delete')"
        >
          <i class="fa-solid fa-trash" aria-hidden="true"></i>
        </button>
        <button
          type="button"
          class="p-1.5 rounded-lg text-ink-muted hover:bg-line"
          :title="open ? 'Thu gọn models' : 'Mở rộng models'"
          @click="$emit('togglePanel')"
        >
          <i class="fa-solid transition-transform duration-200" :class="open ? 'fa-chevron-up' : 'fa-chevron-down'" aria-hidden="true"></i>
        </button>
      </div>
    </div>

    <!-- Test result banner -->
    <div v-if="testResult" class="rounded-lg p-2.5 text-xs font-medium" :class="testResult.includes('Thất bại') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'" role="status">
      {{ testResult }}
    </div>
  </div>
</template>
