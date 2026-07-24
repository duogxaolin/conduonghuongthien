<template>
  <div class="bg-[#F8FAF7]">
    <PageRenderer v-if="blocks.length" :blocks="blocks" :interactive="isPreview" :selected-id="selectedId" />

    <!-- Page exists but has no visible blocks yet. -->
    <section v-else class="section">
      <div class="container text-center py-20">
        <h1 class="text-[1.8rem] font-extrabold text-[#1E251C] mb-3">{{ page?.title }}</h1>
        <p class="text-[#4A5545]">Nội dung đang được cập nhật.</p>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const route = useRoute()
const slug = computed(() => String(route.params.slug || ''))

const { data } = await useAsyncData(
  () => `page-${slug.value}`,
  () => $fetch(`/api/public/pages/${slug.value}`),
  {
    default: () => ({ ok: false, page: null, blocks: [] }),
    watch: [slug],
  }
)

// Builder preview: live-edited blocks pushed via postMessage override the
// fetched ones when this page is embedded in the editor iframe.
const { isPreview, previewBlocks, selectedId } = usePagePreview()

// Unknown slug → real 404 so this catch-all never masks genuine not-found
// routes. Skipped in preview so an in-progress page can still be edited.
if (!isPreview.value && (!data.value?.ok || !data.value?.page)) {
  throw createError({ statusCode: 404, statusMessage: 'Không tìm thấy trang.' })
}

const page = computed(() => data.value?.page || null)
const blocks = computed(() => previewBlocks.value ?? data.value?.blocks ?? [])

useSeoMeta({
  title: () => page.value?.seoTitle || `${page.value?.title || 'Trang'} | Con Đường Hướng Thiện`,
  description: () => page.value?.seoDescription || 'Con Đường Hướng Thiện - Cục C11 Bộ Công an.',
})
</script>
