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
import { computed, watch } from 'vue'

const route = useRoute()
const slug = computed(() => String(route.params.slug || ''))

const asyncData = useAsyncData(
  () => `page-${slug.value}`,
  () => $fetch(`/api/public/pages/${slug.value}`),
  {
    lazy: true,
    default: () => ({ ok: false, page: null, blocks: [] }),
    watch: [slug],
  }
)
const { data, pending, error, refresh, status } = asyncData

// Builder preview: live-edited blocks pushed via postMessage override the
// fetched ones when this page is embedded in the editor iframe.
const { isPreview, previewBlocks, selectedId } = usePagePreview()

// Unknown slug → real 404 so this catch-all never masks genuine not-found
// routes. Skipped in preview so an in-progress page can still be edited.
const isMissing = () => !isPreview.value && (!data.value?.ok || !data.value?.page)

// The 404 has to be decided on BOTH sides, and the two sides need different
// mechanics — which is why this is not the plain `lazy: true` swap the other
// three block-built pages got.
//
// Server: the status code is part of the response, so it must be settled before
// a single byte is written. `lazy` does not stop the server prefetch (Nuxt still
// registers it via onServerPrefetch), but it does stop setup from waiting for
// it — and the check below runs during setup. So the server, and only the
// server, awaits the payload. `import.meta.server` is replaced at build time, so
// the client bundle never contains this branch and client navigation stays
// unblocked. Server-rendered HTML and the SEO tags are therefore unchanged.
if (import.meta.server) {
  await asyncData
  if (isMissing()) throw createError({ statusCode: 404, statusMessage: 'Không tìm thấy trang.' })
}

// Client: the document already exists, so a throw is useless — the error page is
// reached through showError instead. Runs on every settle, which also covers
// navigating between two custom slugs (the fetch re-runs via `watch: [slug]`).
if (import.meta.client) {
  watch(
    [status, data],
    () => {
      if (status.value !== 'success' && status.value !== 'error') return
      if (isMissing()) showError(createError({ statusCode: 404, statusMessage: 'Không tìm thấy trang.' }))
    },
    { immediate: true }
  )
}

const loadError = computed(() => error.value || null)
const page = computed(() => data.value?.page || null)
const blocks = computed(() => previewBlocks.value ?? data.value?.blocks ?? [])

useSeoMeta({
  title: () => page.value?.seoTitle || `${page.value?.title || 'Trang'} | Con Đường Hướng Thiện`,
  description: () => page.value?.seoDescription || 'Con Đường Hướng Thiện - Cục C11 Bộ Công an.',
})
</script>
