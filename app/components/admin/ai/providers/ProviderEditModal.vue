<script setup lang="ts">
/**
 * "Cài đặt kết nối" dialog of one provider: label, Base URL, on/off, a NEW API key (empty
 * keeps the stored one; the field shows `••••` + the last four characters as placeholder,
 * never the key) and "Kiểm tra kết nối" with its result. Display only: the form is the
 * tab's (`v-model:form`); "Lưu" and "Kiểm tra kết nối" are events (`useAiProviderWrites`).
 *
 * Changing the Base URL of a provider that holds a key needs the key typed again in the
 * same save — the server refuses otherwise (`server/api/admin/ai/providers/[id].put.ts`).
 */
import AdminModal from '~/components/admin/AdminModal.vue'
import type { ProviderRow } from '~/utils/ai-service-labels'
import type { ProviderForm } from '~/composables/useAiProviderWrites'

defineProps<{
  /** The provider being edited; null = closed. */
  provider: ProviderRow | null
  busy: boolean
  /** A "Test kết nối" is in flight (any provider). */
  testing: boolean
  /** The test result to show in this dialog, or null. */
  testResult: string | null
}>()
const form = defineModel<ProviderForm>('form', { required: true })
defineEmits<{ close: [], test: [id: number], save: [] }>()
</script>

<template>
  <AdminModal
    :open="!!provider"
    :title="`Cài đặt kết nối: ${provider?.label ?? ''}`"
    :busy="busy"
    @close="$emit('close')"
  >
    <div v-if="provider" class="flex flex-col gap-4">
      <label class="flex flex-col gap-1.5 text-sm font-bold">
        <span class="text-brand-950">Nhãn hiển thị</span>
        <input v-model="form.label" type="text" class="rounded-lg border border-line-strong px-3 py-2 text-sm" />
      </label>
      <label class="flex flex-col gap-1.5 text-sm font-bold">
        <span class="text-brand-950">Base URL</span>
        <input v-model="form.baseUrl" type="text" placeholder="https://..." class="rounded-lg border border-line-strong px-3 py-2 text-sm" />
        <span class="text-xs text-ink-muted font-normal">Chỉ nhận https:// với tên miền công khai. Đổi Base URL thì phải nhập lại API key bên dưới.</span>
      </label>
      <label class="flex items-center gap-3 text-sm font-semibold">
        <input v-model="form.isActive" type="checkbox" class="w-4 h-4 accent-brand-700" />
        <span class="text-brand-950">Kích hoạt nhà cung cấp</span>
      </label>
      <label class="flex flex-col gap-1.5 text-sm font-bold">
        <span class="text-brand-950">API Key mới</span>
        <input v-model="form.apiKey" type="password" :placeholder="provider.apiKeyLastFour ? '••••' + provider.apiKeyLastFour + ' (đã lưu)' : 'Nhập API key'" class="rounded-lg border border-line-strong px-3 py-2 text-sm" />
        <span class="text-xs text-ink-muted font-normal">Để trống để giữ nguyên key hiện tại.</span>
      </label>
      <div v-if="testResult" class="rounded-lg p-3 text-sm" :class="testResult.includes('Thất bại') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'" role="status">{{ testResult }}</div>
    </div>
    <template #footer>
      <button v-if="provider" type="button" class="mr-auto px-4 py-2 rounded-lg border border-line-strong text-sm font-semibold text-ink-muted hover:bg-surface" @click="$emit('test', provider.id)" :disabled="testing">
        {{ testing ? 'Đang kiểm tra...' : 'Kiểm tra kết nối' }}
      </button>
      <button type="button" class="px-4 py-2 rounded-lg border border-line-strong text-sm font-semibold text-ink-muted hover:bg-surface" @click="$emit('close')">Huỷ</button>
      <button type="button" class="px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-semibold hover:bg-brand-900" @click="$emit('save')" :disabled="busy">
        {{ busy ? 'Đang lưu...' : 'Lưu' }}
      </button>
    </template>
  </AdminModal>
</template>
