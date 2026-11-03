<!--
  Mục lục tự động của trang chi tiết bài viết: chỉ hiện khi bài đủ dài để cần điều hướng
  (ArticleDetail.vue quyết định bằng `toc.headings.length >= TOC_MIN_HEADINGS`).

  Chỉ hiển thị (tách từ ArticleDetail.vue ở wave3 4.2): danh sách tiêu đề vào, `v-model:open`
  cho trạng thái mở/gập. Trạng thái đó ở lại ArticleDetail.vue: khối này bị gỡ mỗi khi bài
  tải lại (đổi ngôn ngữ, sang bài khác), và người đọc đã gập mục lục thì nó vẫn gập — như
  trước khi tách. Các neo `#<id>` trỏ vào chính những id mà `buildToc` đóng dấu lên thân
  bài — một lượt duy nhất, nên mục lục và tiêu đề không bao giờ lệch nhau.
-->
<template>
  <nav
    class="my-8 rounded-lg border border-line bg-white px-6 py-5 shadow-sm"
    aria-labelledby="muc-luc-heading"
  >
    <div class="flex items-center justify-between gap-3">
      <h2 id="muc-luc-heading" class="m-0 text-[0.95rem] font-extrabold uppercase tracking-wide text-brand-800">
        <i class="fa-solid fa-list-ul mr-2 text-accent" aria-hidden="true"></i>Mục lục
      </h2>
      <button
        type="button"
        class="rounded px-2 py-1 text-[0.8rem] font-bold text-brand-600 transition hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
        :aria-expanded="tocOpen"
        aria-controls="muc-luc-list"
        @click="tocOpen = !tocOpen"
      >
        {{ tocOpen ? 'Thu gọn' : 'Mở rộng' }}
        <i :class="tocOpen ? 'fa-solid fa-chevron-up' : 'fa-solid fa-chevron-down'" class="ml-1" aria-hidden="true"></i>
      </button>
    </div>
    <ol v-show="tocOpen" id="muc-luc-list" class="mt-4 mb-0 list-none space-y-1.5 pl-0">
      <li
        v-for="heading in headings"
        :key="heading.id"
        :style="{ paddingLeft: `${(heading.level - 2) * 16}px` }"
      >
        <a
          :href="`#${heading.id}`"
          class="text-[0.95rem] font-semibold text-brand-600 no-underline transition hover:text-brand-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
          :class="heading.level > 2 ? 'font-medium text-[0.9rem] text-ink-soft' : ''"
        >{{ heading.text }}</a>
      </li>
    </ol>
  </nav>
</template>

<script setup lang="ts">
import type { TocHeading } from '~/utils/toc'

defineProps<{ headings: TocHeading[] }>()

const tocOpen = defineModel<boolean>('open', { required: true })
</script>
