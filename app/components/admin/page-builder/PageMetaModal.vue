<script setup lang="ts">
/**
 * Hộp "Cấu hình trang" của trình dựng trang — tiêu đề, đường dẫn (khoá với trang hệ thống),
 * SEO. Tách khỏi `pages/admin/content/pages/[id].vue` (wave3 4.2): chỉ hiển thị — biểu mẫu là
 * `v-model:form` (`usePageMeta` giữ), "Lưu" phát `save`, mọi lối đóng phát `close`.
 */
import AdminModal from '~/components/admin/AdminModal.vue'

defineProps<{
  open: boolean
  saving: boolean
  /** Trang hệ thống (home/about/contact): không đổi đường dẫn. */
  isSystem: boolean
}>()

const form = defineModel<{ title: string; slug: string; seoTitle: string; seoDescription: string }>('form', { required: true })

const emit = defineEmits<{ 'close': [], 'save': [] }>()
</script>

<template>
  <AdminModal :open="open" title="Cấu hình trang" :busy="saving" @close="emit('close')">
      <div class="space-y-4">
        <div>
          <label class="mb-1 block text-sm font-semibold text-gray-700">Tiêu đề trang</label>
          <input v-model="form.title" type="text" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-green-600" />
        </div>
        <div>
          <label class="mb-1 block text-sm font-semibold text-gray-700">Đường dẫn (slug)</label>
          <input v-model="form.slug" type="text" :disabled="isSystem" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-green-600 disabled:bg-gray-100 disabled:text-gray-400" />
          <p v-if="isSystem" class="mt-1 text-xs text-gray-400">Trang hệ thống không thể đổi đường dẫn.</p>
        </div>
        <div>
          <label class="mb-1 block text-sm font-semibold text-gray-700">SEO Title</label>
          <input v-model="form.seoTitle" type="text" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-green-600" />
        </div>
        <div>
          <label class="mb-1 block text-sm font-semibold text-gray-700">SEO Description</label>
          <textarea v-model="form.seoDescription" rows="3" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-green-600"></textarea>
        </div>
      </div>
      <template #footer>
        <button type="button" class="rounded-lg px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100" @click="emit('close')">Hủy</button>
        <button type="button" class="inline-flex items-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50" :disabled="saving" @click="emit('save')">
          <i v-if="saving" class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Lưu
        </button>
      </template>
  </AdminModal>
</template>
