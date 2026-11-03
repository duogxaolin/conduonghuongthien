<script setup lang="ts">
/**
 * "Thêm nhà cung cấp mới" dialog of the "Nhà cung cấp & Models" tab. Display only: the form
 * is the tab's (`v-model:form`), picking a preset and "Thêm" are events — the tab
 * (`useAiProviderWrites`) fills the preset and sends the request. The API key field is a
 * password field; the key leaves the browser once, in the request body.
 */
import AdminModal from '~/components/admin/AdminModal.vue'
import { PROVIDER_PRESETS } from '~/utils/ai-service-labels'
import type { NewProviderForm } from '~/composables/useAiProviderWrites'

defineProps<{ open: boolean; busy: boolean; error: string }>()
const form = defineModel<NewProviderForm>('form', { required: true })
defineEmits<{ close: [], presetChange: [], submit: [] }>()
</script>

<template>
  <AdminModal :open="open" title="Thêm nhà cung cấp mới" :busy="busy" @close="$emit('close')">
    <div class="flex flex-col gap-4">
      <label class="flex flex-col gap-1.5 text-sm font-bold">
        <span class="text-brand-950">Loại nhà cung cấp</span>
        <select v-model="form.provider" class="rounded-lg border border-line-strong px-3 py-2 text-sm bg-white" @change="$emit('presetChange')">
          <option v-for="preset in PROVIDER_PRESETS" :key="preset.value" :value="preset.value">{{ preset.label }}</option>
        </select>
        <span v-if="PROVIDER_PRESETS.find(p => p.value === form.provider)?.hint" class="text-xs text-ink-muted font-normal">
          {{ PROVIDER_PRESETS.find(p => p.value === form.provider)?.hint }}
        </span>
      </label>
      <label class="flex flex-col gap-1.5 text-sm font-bold">
        <span class="text-brand-950">Nhãn hiển thị</span>
        <input v-model="form.label" type="text" class="rounded-lg border border-line-strong px-3 py-2 text-sm" />
      </label>
      <label class="flex flex-col gap-1.5 text-sm font-bold">
        <span class="text-brand-950">Base URL</span>
        <input v-model="form.baseUrl" type="text" placeholder="https://..." class="rounded-lg border border-line-strong px-3 py-2 text-sm" />
      </label>
      <label class="flex items-center gap-3 text-sm font-semibold">
        <input v-model="form.isActive" type="checkbox" class="w-4 h-4 accent-brand-700" />
        <span class="text-brand-950">Kích hoạt nhà cung cấp</span>
      </label>
      <label class="flex flex-col gap-1.5 text-sm font-bold">
        <span class="text-brand-950">API Key</span>
        <input v-model="form.apiKey" type="password" placeholder="Nhập API key" class="rounded-lg border border-line-strong px-3 py-2 text-sm" />
        <span class="text-xs text-ink-muted font-normal">Có thể nhập sau nếu chưa có.</span>
      </label>
      <div v-if="error" class="rounded-lg border border-[#f1b8b5] bg-[#fff4f3] p-3 text-sm text-[#a32924]" role="alert">{{ error }}</div>
    </div>
    <template #footer>
      <button type="button" class="px-4 py-2 rounded-lg border border-line-strong text-sm font-semibold text-ink-muted hover:bg-surface" @click="$emit('close')">Huỷ</button>
      <button type="button" class="px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-semibold hover:bg-brand-900" @click="$emit('submit')" :disabled="busy">
        {{ busy ? 'Đang thêm...' : 'Thêm' }}
      </button>
    </template>
  </AdminModal>
</template>
