<script setup lang="ts">
/**
 * Cột soạn của trình soạn bài viết (`pages/admin/content/articles/[id].vue`, tách wave3): thanh
 * AI biên tập, tiêu đề, tóm tắt, nút "Chèn Ảnh Từ Thư Viện" và ô `editorId` mà TinyMCE gắn vào
 * (`useArticleEditorTinymce`). Chỉ hiển thị: tiêu đề/tóm tắt là `v-model` của trang, ảnh chèn
 * qua sự kiện `insert-media`; cầu nối đọc/ghi thân bài đi thẳng xuống `ArticleAIPanel`.
 * Ô trình soạn KHÔNG giới hạn `max-w` (CLAUDE.md: full section width).
 */
import ArticleAIPanel from '~/components/admin/articles/ArticleAIPanel.vue'

defineProps<{
  editorId: string
  getEditorContent: () => string
  setEditorContent: (html: string) => void
}>()

const emit = defineEmits<{
  'insert-media': []
}>()

const title = defineModel<string>('title', { required: true })
const excerpt = defineModel<string>('excerpt', { required: true })
</script>

<template>
  <div class="bg-white rounded-xl border border-line p-6 flex flex-col gap-5">
    <!-- AI Editorial Toolbar (gợi ý tiêu đề / tóm tắt / soát lỗi) — tách vào
         ArticleAIPanel.vue. Con truyền kết quả về qua update:title/excerpt. -->
    <ArticleAIPanel
      :form-title="title"
      :get-editor-content="getEditorContent"
      :set-editor-content="setEditorContent"
      @update:title="title = $event"
      @update:excerpt="excerpt = $event"
    />
    <div class="flex flex-col gap-1.5">
      <label class="text-[0.84rem] font-bold text-ink-admin">Tiêu đề bài viết (*)</label>
      <input
        type="text"
        v-model="title"
        placeholder="Nhập tiêu đề hấp dẫn..."
        class="w-full px-3.5 py-3 border border-line-strong rounded-lg text-[1.1rem] font-bold outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15 box-border"
      />
    </div>

    <div class="flex flex-col gap-1.5">
      <label class="text-[0.84rem] font-bold text-ink-admin">Tóm tắt bài viết (Excerpt)</label>
      <textarea
        v-model="excerpt"
        rows="3"
        placeholder="Nhập đoạn tóm tắt ngắn hiển thị ở trang danh sách..."
        class="w-full px-3.5 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15 box-border resize-none font-[inherit]"
      ></textarea>
    </div>

    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <label class="text-[0.84rem] font-bold text-ink-admin">Nội dung chi tiết (HTML / Editor)</label>
        <button
          class="inline-flex items-center gap-1.5 bg-surface-tint text-brand-700 border border-brand-300 px-2.5 py-1.5 rounded-md text-[0.78rem] font-bold cursor-pointer hover:bg-[#e4f2e5] transition-colors"
          @click="emit('insert-media')"
        >
          <i class="fa-regular fa-images"></i> Chèn Ảnh Từ Thư Viện
        </button>
      </div>
      <div :id="editorId" class="min-h-[700px]"></div>
    </div>
  </div>
</template>
