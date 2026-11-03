<script setup lang="ts">
/**
 * "Thêm Model cho <provider>" dialog: model id, label, the two prices per 1M tokens, on/off.
 * Display only: the form is the tab's (`v-model:form`); "Thêm Model" is an event
 * (`useAiModelWrites.addModelToProvider`), whose refusal comes back in `error`.
 */
import AdminModal from '~/components/admin/AdminModal.vue'
import type { NewModelForm } from '~/composables/useAiModelWrites'

defineProps<{ open: boolean; providerName: string; busy: boolean; error: string }>()
const form = defineModel<NewModelForm>('form', { required: true })
defineEmits<{ close: [], submit: [] }>()
</script>

<template>
  <AdminModal
    :open="open"
    :title="`Thêm Model cho ${providerName}`"
    :busy="busy"
    @close="$emit('close')"
  >
    <div class="flex flex-col gap-4">
      <label class="flex flex-col gap-1.5 text-sm font-bold">
        <span class="text-brand-950">Mã Model (ID gọi API)</span>
        <input v-model="form.model" type="text" placeholder="flash, glm-5.3, gpt-4o..." class="rounded-lg border border-line-strong px-3 py-2 text-sm font-mono" />
      </label>
      <label class="flex flex-col gap-1.5 text-sm font-bold">
        <span class="text-brand-950">Tên hiển thị (Label)</span>
        <input v-model="form.label" type="text" placeholder="GLM 5.3 Thông minh..." class="rounded-lg border border-line-strong px-3 py-2 text-sm" />
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
        <span class="text-brand-950">Kích hoạt model (cho phép các dịch vụ sử dụng)</span>
      </label>
      <div v-if="error" class="rounded-lg border border-[#f1b8b5] bg-[#fff4f3] p-3 text-sm text-[#a32924]" role="alert">{{ error }}</div>
    </div>
    <template #footer>
      <button type="button" class="px-4 py-2 rounded-lg border border-line-strong text-sm font-semibold text-ink-muted hover:bg-surface" @click="$emit('close')">Huỷ</button>
      <button type="button" class="px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-semibold hover:bg-brand-900" @click="$emit('submit')" :disabled="busy">
        {{ busy ? 'Đang thêm...' : 'Thêm Model' }}
      </button>
    </template>
  </AdminModal>
</template>
