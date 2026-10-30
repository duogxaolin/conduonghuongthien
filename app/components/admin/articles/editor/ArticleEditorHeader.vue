<script setup lang="ts">
/**
 * Đầu trang trình soạn bài viết (`pages/admin/content/articles/[id].vue`, tách wave3): tiêu đề,
 * menu "Tự động dịch" (bài mới) hoặc nút "Bản dịch" (bài có sẵn), "Hủy & Quay lại", nút lưu.
 * Chỉ hiển thị: props vào, sự kiện ra. Nút lưu tắt khi `saving || !loaded` — lớp chặn thứ nhất;
 * lớp thứ hai (`handleSave` tự kiểm `loaded`) ở `useArticleEditorSave`, nên ở đây `save` phát
 * không điều kiện. Ngôn ngữ tự động dịch là `v-model:auto-translate-langs` của trang.
 */
import type { ArticleEditorLanguage } from '~/types/admin-article-editor'

defineProps<{
  isNew: boolean
  saving: boolean
  loaded: boolean
  availableLanguages: ArticleEditorLanguage[]
}>()

const emit = defineEmits<{
  save: []
  'scroll-to-translations': []
}>()

const autoTranslateLangs = defineModel<string[]>('autoTranslateLangs', { required: true })
const showAutoTranslateMenu = ref(false)
</script>

<template>
  <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
    <div>
      <h1 class="text-[1.3rem] font-extrabold text-brand-950 m-0">
        {{ isNew ? '✍️ Viết Bài Mới' : '✏️ Chỉnh Sửa Bài Viết' }}
      </h1>
      <p class="text-[0.85rem] text-ink-muted mt-1 mb-0">Soạn thảo nội dung tin tức, bài viết bài bản với thư viện ảnh tích hợp</p>
    </div>
    <div class="flex items-center gap-2 flex-wrap">
      <!-- Khi tạo mới (isNew): Tích chọn những ngôn ngữ muốn tự động dịch qua -->
      <div v-if="isNew" class="relative">
        <button
          type="button"
          class="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg border text-sm font-bold cursor-pointer transition-colors"
          :class="autoTranslateLangs.length > 0
            ? 'border-brand-700 bg-surface-tint text-brand-900'
            : 'border-line-strong bg-white text-ink-muted hover:bg-surface'"
          @click="showAutoTranslateMenu = !showAutoTranslateMenu"
        >
          <i class="fa-solid fa-language text-sm"></i>
          <span>{{ autoTranslateLangs.length > 0 ? `Tự động dịch (${autoTranslateLangs.length})` : 'Tự động dịch...' }}</span>
          <i class="fa-solid fa-chevron-down text-[0.6rem]"></i>
        </button>

        <!-- Popover chọn ngôn ngữ -->
        <div
          v-if="showAutoTranslateMenu"
          class="absolute right-0 top-full mt-1.5 w-60 rounded-xl bg-white border border-line-strong shadow-xl p-3 z-30 flex flex-col gap-2"
        >
          <div class="flex items-center justify-between border-b border-line pb-1.5 text-xs">
            <span class="font-bold text-brand-950">Chọn ngôn ngữ dịch tự động:</span>
            <button
              type="button"
              class="text-[0.68rem] text-brand-700 hover:underline bg-transparent border-0 cursor-pointer p-0"
              @click="autoTranslateLangs = autoTranslateLangs.length === availableLanguages.length ? [] : availableLanguages.map(l => l.code)"
            >
              {{ autoTranslateLangs.length === availableLanguages.length ? 'Bỏ chọn' : 'Tất cả' }}
            </button>
          </div>
          <div class="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
            <label
              v-for="l in availableLanguages"
              :key="l.code"
              class="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-surface-tint cursor-pointer text-xs font-semibold text-brand-950"
            >
              <input
                type="checkbox"
                :value="l.code"
                v-model="autoTranslateLangs"
                class="h-3.5 w-3.5 accent-brand-700 rounded"
              />
              <span>{{ l.flag }}</span>
              <span>{{ l.label }}</span>
            </label>
          </div>
          <p class="m-0 text-[0.68rem] text-ink-muted border-t border-line pt-1.5">
            Sau khi lưu bài gốc, hệ thống sẽ tự động kích hoạt dịch sang các ngôn ngữ đã chọn trong nền.
          </p>
        </div>
      </div>

      <!-- Khi chỉnh sửa (!isNew): Nút xem nhanh bản dịch -->
      <button
        v-else
        type="button"
        class="inline-flex items-center gap-1.5 bg-white border border-line-strong text-brand-900 hover:bg-surface-tint px-3.5 py-2.5 rounded-lg text-sm font-bold cursor-pointer transition-colors"
        @click="emit('scroll-to-translations')"
      >
        <i class="fa-solid fa-language text-sm"></i>
        <span>Bản dịch ({{ availableLanguages.length }} ngôn ngữ)</span>
      </button>
      <nuxt-link
        to="/admin/content/articles"
        class="inline-flex items-center bg-white border border-line-strong text-ink-muted no-underline px-4 py-2.5 rounded-lg font-semibold hover:bg-surface transition-colors"
      >Hủy & Quay lại</nuxt-link>
      <button
        class="inline-flex items-center gap-2 bg-brand-900 hover:bg-brand-700 text-white font-bold px-5 py-2.5 rounded-lg cursor-pointer transition-colors border-0 disabled:opacity-60 disabled:cursor-not-allowed"
        :disabled="saving || !loaded"
        @click="emit('save')"
      >
        <i class="fa-solid fa-floppy-disk"></i>
        {{ saving ? 'Đang lưu...' : (isNew ? 'Đăng Bài Mới' : 'Cập Nhật Bài Viết') }}
      </button>
    </div>
  </div>
</template>
