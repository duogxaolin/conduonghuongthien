<template>
  <div class="bg-[#F8FAF7]">
    <PageRenderer
      v-if="pending || loadError || blocks.length"
      :blocks="blocks"
      :interactive="isPreview"
      :selected-id="selectedId"
      :pending="pending"
      :load-error="loadError"
      :on-retry="refresh"
    />

    <!-- Fallback if the page has no blocks yet. -->
    <section v-else class="section">
      <div class="container text-center py-20">
        <h1 class="text-[1.8rem] font-extrabold text-[#1E251C] mb-3">Giới thiệu</h1>
        <p class="text-[#4A5545]">Nội dung đang được cập nhật.</p>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed } from 'vue'

// `lazy`: bỏ chặn điều hướng phía client, lượt dựng phía máy chủ vẫn chờ dữ
// liệu nên HTML đầu tiên và thẻ SEO không đổi (design.md D2).
const { data, pending, error, refresh } = useAsyncData(
  'page-about',
  () => $fetch('/api/public/pages/about'),
  { lazy: true, default: () => ({ ok: false, page: null, blocks: [] }) }
)

const loadError = computed(() => error.value || null)
const page = computed(() => data.value?.page || null)

// Builder preview: when embedded in the editor iframe, live-edited blocks
// pushed via postMessage override the fetched ones (see usePagePreview).
const { isPreview, previewBlocks, selectedId } = usePagePreview()
const blocks = computed(() => previewBlocks.value ?? data.value?.blocks ?? [])

useSeoMeta({
  title: () => page.value?.seoTitle || 'Giới thiệu | Con Đường Hướng Thiện',
  description: () => page.value?.seoDescription || 'Giới thiệu Ban Biên tập Cổng thông tin Con Đường Hướng Thiện - Cục C11 Bộ Công an.',
})
</script>
