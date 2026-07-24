<template>
  <div class="bg-[#F8FAF7]">
    <PageRenderer v-if="blocks.length" :blocks="blocks" :interactive="isPreview" :selected-id="selectedId" />

    <!-- Fallback if the page has no blocks yet. -->
    <section v-else class="section">
      <div class="container text-center py-20">
        <h1 class="text-[1.8rem] font-extrabold text-[#1E251C] mb-3">Liên hệ &amp; Trợ giúp</h1>
        <p class="text-[#4A5545]">Nội dung đang được cập nhật. Hotline 0903.480.985.</p>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const { data } = await useAsyncData(
  'page-contact',
  () => $fetch('/api/public/pages/contact'),
  { default: () => ({ ok: false, page: null, blocks: [] }) }
)

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
