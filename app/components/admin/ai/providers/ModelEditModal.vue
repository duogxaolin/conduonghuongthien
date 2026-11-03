<script setup lang="ts">
/**
 * "Sửa Model" dialog: label, the two prices per 1M tokens, on/off of one model. Display
 * only: the form is the tab's (`v-model:form`); "Lưu" is an event
 * (`useAiModelWrites.saveEditModel`).
 */
import AdminModal from '~/components/admin/AdminModal.vue'
import type { PricingRow } from '~/utils/ai-service-labels'
import type { EditModelForm } from '~/composables/useAiModelWrites'

defineProps<{
  /** The model being edited; null = closed. */
  model: PricingRow | null
  busy: boolean
}>()
const form = defineModel<EditModelForm>('form', { required: true })
defineEmits<{ close: [], save: [] }>()
</script>

<template>
  <AdminModal
    :open="!!model"
    :title="`Sửa Model: ${model?.model ?? ''}`"
    :busy="busy"
    @close="$emit('close')"
  >
    <div v-if="model" class="flex flex-col gap-4">
      <p class="m-0 text-xs text-ink-muted">Nhà cung cấp: <strong>{{ model.provider }}</strong></p>
      <label class="flex flex-col gap-1.5 text-sm font-bold">
        <span class="text-brand-950">Tên hiển thị</span>
        <input v-model="form.label" type="text" class="rounded-lg border border-line-strong px-3 py-2 text-sm" />
      </label>
      <div class="grid grid-cols-2 gap-3">
        <label class="flex flex-col gap-1.5 text-sm font-bold">
          <span class="text-brand-950">Giá Input ($ / 1M)</span>
          <input v-model.number="form.promptCostPerMillion" type="number" step="0.001" min="0" class="rounded-lg border border-line-strong px-3 py-2 text-sm" />
        </label>
        <label class="flex flex-col gap-1.5 text-sm font-bold">
          <span class="text-brand-950">Giá Output ($ / 1M)</span>
          <input v-model.number="form.completionCostPerMillion" type="number" step="0.001" min="0" class="rounded-lg border border-line-strong px-3 py-2 text-sm" />
        </label>
      </div>
      <label class="flex items-center gap-3 text-sm font-semibold">
        <input v-model="form.isActive" type="checkbox" class="w-4 h-4 accent-brand-700" />
        <span class="text-brand-950">Kích hoạt model này</span>
      </label>
    </div>
    <template #footer>
      <button type="button" class="px-4 py-2 rounded-lg border border-line-strong text-sm font-semibold text-ink-muted hover:bg-surface" @click="$emit('close')">Huỷ</button>
      <button type="button" class="px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-semibold hover:bg-brand-900" @click="$emit('save')" :disabled="busy">
        {{ busy ? 'Đang lưu...' : 'Lưu' }}
      </button>
    </template>
  </AdminModal>
</template>
