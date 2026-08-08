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
        <h1 class="text-[1.8rem] font-extrabold text-[#1E251C] mb-3">Liên hệ &amp; Trợ giúp</h1>
        <p class="text-[#4A5545]">Nội dung đang được cập nhật. Hotline 0903.480.985.</p>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

// `lazy`: bỏ chặn điều hướng phía client, lượt dựng phía máy chủ vẫn chờ dữ
// liệu nên HTML đầu tiên và thẻ SEO không đổi (design.md D2).
const { data, pending, error, refresh } = useAsyncData(
  'page-contact',
  () => $fetch('/api/public/pages/contact'),
  { lazy: true, default: () => ({ ok: false, page: null, blocks: [] }) }
)

const loadError = computed(() => error.value || null)
const page = computed(() => data.value?.page || null)

// Builder preview: when embedded in the editor iframe, live-edited blocks
// pushed via postMessage override the fetched ones (see usePagePreview).
const { isPreview, previewBlocks, selectedId } = usePagePreview()
const blocks = computed(() => previewBlocks.value ?? data.value?.blocks ?? [])

useSeoMeta({
  title: () => page.value?.seoTitle || 'Liên hệ & Trợ giúp | Con Đường Hướng Thiện',
  description: () => page.value?.seoDescription || 'Liên hệ Ban Biên tập và gửi yêu cầu trợ giúp tái hòa nhập cộng đồng. Hotline 0903.480.985.',
})
</script>
