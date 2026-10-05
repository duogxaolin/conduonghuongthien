<template>
  <div class="bg-[#F8FAF7]">
    <!-- Branch 1: Page Builder page (existing behavior) — render blocks khi có -->
    <PageRenderer
      v-if="isPageBranch && (pending || loadError || blocks.length)"
      :blocks="blocks"
      :interactive="isPreview"
      :selected-id="selectedId"
      :pending="pending"
      :load-error="loadError"
      :on-retry="refresh"
    />

    <!-- Page exists but has no visible blocks yet. -->
    <section v-else-if="isPageBranch && page" class="section">
      <div class="container text-center py-20">
        <h1 class="text-[1.8rem] font-extrabold text-[#1E251C] mb-3">{{ page?.title }}</h1>
        <p class="text-[#4A5545]">Nội dung đang được cập nhật.</p>
      </div>
    </section>

    <!-- Branch 2: Content-Type list (type custom không có route tĩnh) -->
    <ContentTypeListSection
      v-else-if="contentTypeMatch"
      :type-slug="slug"
      :type-name="contentTypeMatch.name"
      :type-icon="contentTypeMatch.icon || ''"
      :type-description="contentTypeMatch.description || ''"
    />

    <!-- Branch 3: neither — 404 handled by createError below, render empty to avoid flash -->
    <div v-else></div>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'

const route = useRoute()
const slug = computed(() => String(route.params.slug || ''))

const asyncData = useAsyncData(
  () => `page-${slug.value}`,
  () => ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; page: { title?: string; slug?: string; seoTitle?: string | null; seoDescription?: string | null } | null; blocks: import('~/utils/blocks/types').RenderableNode[] }>)(`/api/public/pages/${slug.value}`),
  {
    lazy: true,
    default: () => ({ ok: false, page: null, blocks: [] }),
    watch: [slug],
  }
)
const { data, pending, error, refresh, status } = asyncData

// Branch 2: Content-Type list. Khi `/api/public/pages/<slug>` trả không có page
// block, slug có thể là `slug` của một content-type custom (vd /video_tuyen_truyen).
// Fetch danh sách content-types công khai để khớp. useAsyncData riêng để không
// phụ thuộc vào cache key của page fetch — chỉ thực sự fetch khi page miss.
interface PublicContentType { slug: string; name: string; icon: string | null; description: string | null }
const typesAsync = useAsyncData(
  () => `content-types-catchall-${slug.value}`,
  () => ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; items: PublicContentType[] }>)(`/api/public/content-types`),
  {
    lazy: true,
    default: () => ({ ok: false, items: [] }),
    watch: [slug],
  }
)
const { data: typesData, status: typesStatus } = typesAsync

const contentTypeMatch = computed(() => {
  const items = typesData.value?.items || []
  return items.find((ct) => ct.slug === slug.value) || null
})

const isPageBranch = computed(() => {
  // Branch 1 thẳng khi page block tồn tại (data.ok + data.page), OR khi đang
  // pending/error ở lượt fetch đầu tiên để PageRenderer tự lo skeleton/error.
  // Khi data đã settle mà không có page → nhường sang Branch 2.
  const settled = status.value === 'success' || status.value === 'error'
  if (!settled) return true
  return !!(data.value?.ok && data.value?.page)
})

// Builder preview: live-edited blocks pushed via postMessage override the
// fetched ones when this page is embedded in the editor iframe.
const { isPreview, previewBlocks, selectedId } = usePagePreview()

// Unknown slug → real 404 so this catch-all never masks genuine not-found
// routes. Skipped in preview so an in-progress page can still be edited.
// Nay cũng áp cho content-type miss: page miss + type miss → 404.
const isMissing = () => {
  if (isPreview.value) return false
  const pageMiss = !data.value?.ok || !data.value?.page
  if (!pageMiss) return false
  // Page miss → kiểm content-type
  const typesSettled = typesStatus.value === 'success' || typesStatus.value === 'error'
  if (!typesSettled) return false // đang fetch type, chưa kết luận 404
  return !contentTypeMatch.value
}

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
//
// Nay phải awaited CẢ hai asyncData (page + types) để sure 404 trước khi SSR ghi.
if (import.meta.server) {
  await asyncData
  // Chỉ fetch content-types nếu page miss (tiết kiệm truy vấn khi page hit).
  if (!data.value?.ok || !data.value?.page) {
    await typesAsync
  }
  if (isMissing()) throw createError({ statusCode: 404, statusMessage: 'Không tìm thấy trang.' })
}

// Client: the document already exists, so a throw is useless — the error page is
// reached through showError instead. Runs on every settle, which also covers
// navigating between two custom slugs (the fetch re-runs via `watch: [slug]`).
if (import.meta.client) {
  watch(
    [status, data, typesStatus, typesData],
    () => {
      // Chưa settle cả hai → chờ
      const anyPending = status.value !== 'success' && status.value !== 'error'
      const pageMiss = status.value === 'success' || status.value === 'error'
        ? (!data.value?.ok || !data.value?.page)
        : false
      // Nếu page hit → không cần types để kết luận (không 404)
      if (!pageMiss) {
        if (anyPending) return
        if (isMissing()) showError(createError({ statusCode: 404, statusMessage: 'Không tìm thấy trang.' }))
        return
      }
      // Page miss → cần types settle để kết luận
      if (typesStatus.value !== 'success' && typesStatus.value !== 'error') return
      if (isMissing()) showError(createError({ statusCode: 404, statusMessage: 'Không tìm thấy trang.' }))
    },
    { immediate: true }
  )
}

const loadError = computed(() => error.value || null)
const page = computed(() => data.value?.page || null)
const blocks = computed(() => previewBlocks.value ?? data.value?.blocks ?? [])

useSeoMeta({
  title: () => page.value?.seoTitle || (contentTypeMatch.value ? `${contentTypeMatch.value.name} | Con Đường Hướng Thiện` : `${page.value?.title || 'Trang'} | Con Đường Hướng Thiện`),
  description: () => page.value?.seoDescription || contentTypeMatch.value?.description || 'Con Đường Hướng Thiện - Cục C11 Bộ Công an.',
})
</script>
