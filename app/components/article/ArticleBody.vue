<!--
  Thân bài viết trên trang chi tiết: HTML của bài, kèm kiểu chữ cho nội dung đó.

  Tách từ ArticleDetail.vue ở wave3 4.2. `html` là `toc.html` của ArticleDetail.vue —
  `articles.content` (sanitizeHtml lúc ghi VÀ ở endpoint công khai) đã qua `buildToc` đóng
  dấu id lên tiêu đề. ArticleDetail.vue là nơi DUY NHẤT dùng component này, và chỉ với
  `:html="toc.html"`: tests/security-ai-editorial-html.test.ts kiểm kê `v-html` dưới đây và
  chặn mọi nơi dùng khác (một prop `html` là một cửa vào `v-html` cho bất kỳ ai gọi nó).

  Ẩn ảnh 404 gắn vào CHÍNH phần tử này lúc nó mount. Trước khi tách, việc gắn chạy lúc
  ArticleDetail mount — khi bài tới SAU mount (điều hướng phía client, đổi ngôn ngữ) thân
  bài chưa tồn tại và không ảnh lỗi nào được ẩn (FINDING-D1).
-->
<template>
  <div ref="articleBodyEl" class="article-body text-[1.05rem] leading-[1.7] text-ink-secondary">
    <!-- eslint-disable-next-line vue/no-v-html -- content authored by C11 editors, sanitized on write -->
    <div v-html="html"></div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useBrokenImageFallback } from '~/composables/useBrokenImageFallback'

defineProps<{
  /** `toc.html` of ArticleDetail.vue — sanitized article content with heading ids stamped in. */
  html: string
}>()

// Ảnh trong thân bài bị 404 (ảnh từ trang cũ không còn tệp) thì ẩn thay vì hiện khung vỡ.
const articleBodyEl = ref<HTMLElement | null>(null)
useBrokenImageFallback(articleBodyEl)
</script>

<style scoped>
/* Retained for v-html deep content — not expressible with Tailwind utility classes */

/* Anchor landing offset. The public header becomes `fixed` once the visitor
   scrolls (see layouts/default.vue), so a bare #fragment jump puts the target
   heading underneath it — the reader clicks a table-of-contents entry and lands
   on the paragraph above the one they asked for. 130px clears the desktop
   header, which is the taller of the two. */
.article-body :deep(h2),
.article-body :deep(h3),
.article-body :deep(h4) { scroll-margin-top: 130px; }

/* Article bodies had no heading rules at all, so an h2 written in the editor
   rendered at the browser default inside otherwise styled prose. The outline
   only exists once authors write headings, so they need to look deliberate.
   Sizes match the richtext block (components/blocks/RichTextBlock.vue) — the
   two render the same admin-authored HTML and should not disagree. */
.article-body :deep(h2) { font-size: 1.5rem; font-weight: 800; color: #1E251C; margin: 2rem 0 0.8rem; }
.article-body :deep(h3) { font-size: 1.2rem; font-weight: 800; color: #1E251C; margin: 1.6rem 0 0.6rem; }
.article-body :deep(h4) { font-size: 1.05rem; font-weight: 700; color: #2b352a; margin: 1.3rem 0 0.5rem; }

.article-body :deep(p) { font-size: 1.05rem; line-height: 1.7; color: #4A5545; margin-bottom: 20px; }
.article-body :deep(blockquote) { background-color: #F8FAF7; border-left: 4px solid #4A6741; padding: 20px 24px; margin: 30px 0; font-style: italic; font-size: 1.1rem; color: #385130; }
.article-body :deep(blockquote span) { display: block; font-size: 0.85rem; color: #7A8675; margin-top: 8px; font-weight: 700; font-style: normal; }

/* Ảnh và video chèn trong nội dung bài viết — không tràn vùng đọc. Admin editor
   cho phép chèn ảnh/video kích thước nguyên bản; nếu không có max-width chúng
   sẽ tràn mép container (1240px) trên desktop. `max-width: 100%` ép co về khít
   vùng chữ, `height: auto` giữ tỷ lệ khung. Đây là phần render công khai (không
   phải admin editor — editor giữ full section để thao tác). */
.article-body :deep(img),
.article-body :deep(video) {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
  margin: 1.5rem 0;
}

/* iframe YouTube nhúng trong bài viết — responsive 16:9. `src` đã được sanitizer
   rewrite sang youtube-nocookie.com và chỉ cho phép YouTube embed, nên an toàn
   cho `v-html`. `max-width: 100%` + `aspect-ratio` giữ video không tràn khung
   đọc trên mobile. */
.article-body :deep(iframe) {
  max-width: 100%;
  aspect-ratio: 16 / 9;
  width: 100%;
  height: auto;
  border: 0;
  border-radius: 12px;
  margin: 1.5rem 0;
}
</style>
