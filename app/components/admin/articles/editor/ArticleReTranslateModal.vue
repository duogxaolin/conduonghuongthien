<script setup lang="ts">
/**
 * Hộp nhắc dịch lại của trình soạn bài viết (`pages/admin/content/articles/[id].vue`, tách
 * wave3): sau một lượt lưu đổi tiêu đề/tóm tắt/nội dung tiếng Việt, hỏi có dịch lại mọi ngôn ngữ
 * không. Chỉ hiển thị: "xuất bản luôn" là `v-model:publish-immediately` của trang; mở/đóng và
 * lượt dịch (`confirm`) do `useArticleEditorSave` làm, `running` khoá hộp trong lúc đó.
 */
import AdminModal from '~/components/admin/AdminModal.vue'
import type { ArticleEditorLanguage } from '~/types/admin-article-editor'

defineProps<{
  open: boolean
  running: boolean
  availableLanguages: ArticleEditorLanguage[]
}>()

const emit = defineEmits<{
  close: []
  confirm: []
}>()

const publishImmediately = defineModel<boolean>('publishImmediately', { required: true })
</script>

<template>
  <!-- Modal: Nhắc nhở cập nhật bản dịch khi nội dung Tiếng Việt thay đổi -->
  <AdminModal
    :open="open"
    title="Phát hiện nội dung Tiếng Việt vừa thay đổi!"
    icon="fa-solid fa-lightbulb"
    :busy="running"
    @close="emit('close')"
  >
    <div class="flex flex-col gap-4">
      <p class="m-0 text-xs text-ink-muted">
        Bài viết gốc Tiếng Việt vừa được cập nhật nội dung mới. Bạn có muốn AI tự động cập nhật và dịch lại toàn bộ các ngôn ngữ quốc tế khác không?
      </p>

      <!-- Target languages preview -->
      <div class="flex flex-col gap-1.5">
        <label class="text-xs font-bold text-brand-950">Các ngôn ngữ sẽ được đồng bộ hóa lại:</label>
        <div class="flex flex-wrap gap-1.5">
          <span
            v-for="l in availableLanguages"
            :key="l.code"
            class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-tint border border-[#c8dcc9] text-xs font-bold text-brand-900"
          >
            <span>{{ l.flag }}</span>
            <span>{{ l.label }}</span>
          </span>
        </div>
      </div>

      <!-- Publish Option -->
      <label class="flex items-center gap-2.5 p-3 rounded-xl bg-surface border border-surface-tint cursor-pointer text-xs text-ink">
        <input
          type="checkbox"
          v-model="publishImmediately"
          class="h-4 w-4 accent-brand-700 rounded"
        />
        <div class="flex flex-col">
          <span class="font-bold">Tự động xuất bản luôn các bản dịch mới</span>
          <span class="text-[0.68rem] text-ink-muted">Nếu không chọn, bản dịch sẽ lưu ở dạng Bản nháp AI để rà soát trước.</span>
        </div>
      </label>

    </div>
    <template #footer>
        <button
          type="button"
          class="px-4 py-2.5 rounded-xl border border-line-strong bg-white text-xs font-semibold text-ink-muted hover:bg-gray-50 cursor-pointer"
          @click="emit('close')"
        >
          Để sau / Giữ bản dịch hiện tại
        </button>
        <button
          type="button"
          class="px-5 py-2.5 rounded-xl bg-brand-900 hover:bg-[#153317] text-white text-xs font-extrabold cursor-pointer border-none flex items-center gap-2 shadow-sm transition-all hover:-translate-y-0.5 disabled:opacity-50"
          :disabled="running"
          @click="emit('confirm')"
        >
          <i class="fa-solid fa-wand-magic-sparkles text-xs" :class="running ? 'animate-spin' : ''" aria-hidden="true"></i>
          <span>{{ running ? 'Đang kích hoạt...' : '⚡ Dịch lại tất cả ngay' }}</span>
        </button>
    </template>
  </AdminModal>
</template>
