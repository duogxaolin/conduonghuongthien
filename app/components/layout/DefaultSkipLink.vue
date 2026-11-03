<template>
  <!-- Skip link: bàn phím/tab qua header tới nội dung chính — yêu cầu a11y
       cho cổng thông tin nhà nước (Luật Người khuyết tật 2010 / NĐ 28/2012). -->
  <a href="#main-content" class="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:bg-brand-700 focus:text-white focus:rounded-lg">{{ t('skip_to_content') }}</a>
</template>

<script setup lang="ts">
/**
 * Liên kết "Bỏ qua tới nội dung" của layout công khai, tách khỏi `layouts/default.vue` (tệp
 * đó không nhận thêm logic) để dịch được: bản tiếng Anh từng đọc nguyên câu tiếng Việt.
 * HTML cache (`swr`) vẫn tiếng Việt; chữ đổi sau hydrate như mọi chữ khác của layout.
 */
import { useI18n } from '~/composables/useI18n'

const { t } = useI18n()
</script>
