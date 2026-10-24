<template>
  <div class="bg-[#F8FAF7]">
    <!-- Branch 4 (2-segment /<type>/<X>): dishwasher — category list | article detail -->
    <template v-if="idParam">
      <ContentTypeListSection
        v-if="isCategoryView"
        :type-slug="slug"
        :type-name="typeName"
        :type-icon="metaIcon"
        :type-description="currentType?.description || ''"
        :category-slug="idParam"
      />
      <!-- Lượt kiểm chuyên mục HỎNG: chưa biết X là chuyên mục hay bài — không rơi
           sang ArticleDetail, không 404; báo lỗi + thử lại (SSR 503). -->
      <section v-else-if="showCategoryLookupError" class="section">
        <div class="container py-10 md:py-16">
          <BlockLoadError
            title="Không thể tải trang"
            description="Đã xảy ra lỗi khi kết nối dữ liệu máy chủ."
            retry-label="Thử lại"
            :retrying="categoryRetrying"
            @retry="retryCategoryLookup"
          />
        </div>
      </section>
      <ArticleDetail
        v-else
        :slug="idParam"
        :back-to="`/${slug}`"
        :back-label="typeName"
        :meta-icon="metaIcon"
        :type-labels="typeLabels"
        :seo-fallback-title="seoTitle"
        :seo-fallback-description="seoDescription"
      />
    </template>

    <!-- Branch 1: Page Builder page (existing behavior) — render blocks khi có.
         Một trang đúng một <h1> (D22): khi không khối nào tự có <h1> (hero),
         trang đặt một <h1> cho trình đọc màn hình mang tiêu đề trang. -->
    <template v-else-if="isPageBranch && (pending || loadError || blocks.length)">
      <h1 v-if="blocks.length && !pageHasOwnH1" class="sr-only">{{ page?.title }}</h1>
      <PageRenderer
        :blocks="blocks"
        :interactive="isPreview"
        :selected-id="selectedId"
        :pending="pending"
        :load-error="loadError"
        :on-retry="retryLookup"
      />
    </template>

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
import { computed, onMounted, ref, watch } from 'vue'
import { useSsrFailureStatus } from '~/composables/useSsrFailureStatus'
import { resolveCategoryRoute } from '~/utils/category-route-decision'
import { blocksRenderOwnH1 } from '~/utils/blocks/page-heading'
// Import tường minh: tên tự động của Nuxt là `BlocksBlockLoadError` — `<BlockLoadError>`
// không import sẽ dựng ra thẻ rỗng (đã gặp ở `news/[category]/index.vue`).
import BlockLoadError from '~/components/blocks/BlockLoadError.vue'

const route = useRoute()
const slug = computed(() => String(route.params.slug || ''))
// 2-segment route `/<type>/<X>`: vì `[slug].vue` là parent route của
// `[slug]/[id].vue` theo nested-routing Nuxt 4, và parent không có `<NuxtPage />`
// nên child không bao giờ render. Ta gộp dishwasher 2-segment vào chính
// `[slug].vue` này — `idParam` tồn tại ⇔ route `/api/public/articles`.
const idParam = computed(() => (route.params.id ? String(route.params.id) : ''))

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

const currentType = computed(() => contentTypeMatch.value)
const typeName = computed(() => currentType.value?.name || slug.value)
const metaIcon = computed(() => currentType.value?.icon || 'fa-solid fa-folder')
const seoTitle = computed(() => `${typeName.value} | Con Đường Hướng Thiện`)
const seoDescription = computed(() => currentType.value?.description || 'Con Đường Hướng Thiện - Cục C11 Bộ Công an.')
const typeLabels = computed(() => ({ [slug.value]: typeName.value }))

// Branch 4: 2-segment `/<type>/<X>` — kiểm `X` trùng category slug trong type.
interface PublicCategory { id: number; name: string; slug: string; parentId: number | null }
const catAsync = useAsyncData(
  () => `cat-check-${slug.value}-${idParam.value}`,
  () => ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; items: PublicCategory[] }>)('/api/public/categories', { query: { type: slug.value } }),
  { lazy: true, default: () => ({ ok: true, items: [] as PublicCategory[] }), watch: [slug, idParam] },
)
const { data: catData, status: catStatus } = catAsync

/**
 * Cùng quyết định với `/news/<X>` (`utils/category-route-decision.ts`): lượt kiểm
 * chuyên mục HỎNG không phải "không phải chuyên mục". Trước đây `status === 'error'`
 * được tính là đã xong với danh sách rỗng → trang rơi sang ArticleDetail, hiện "bài
 * không tải được" cho một chuyên mục có thật (và SSR 200 khi CSDL sập).
 * `pending` → ArticleDetail như cũ (bài là trường hợp phổ biến).
 */
const categoryDecision = computed(() => (idParam.value
  ? resolveCategoryRoute({ status: catStatus.value, data: catData.value, slug: idParam.value })
  : 'pending'))
const isCategoryView = computed(() => categoryDecision.value === 'category')
const categoryLookupFailed = computed(() => !!idParam.value && categoryDecision.value === 'lookup-failed')

// Đang thử lại sau một lượt hỏng: giữ nhánh lỗi (nút quay) thay vì nhảy tạm sang
// ArticleDetail trong lúc lượt đọc mới còn bay.
const categoryRetrying = ref(false)
const showCategoryLookupError = computed(() => categoryLookupFailed.value || (categoryRetrying.value && categoryDecision.value === 'pending'))
const retryCategoryLookup = async () => {
  if (categoryRetrying.value) return
  categoryRetrying.value = true
  try {
    await catAsync.refresh()
  } finally {
    categoryRetrying.value = false
  }
}

/**
 * Lượt đọc HỎNG (503 từ máy chủ, mạng đứt) khác hẳn "không có trang": hỏng thì
 * chưa biết trang có tồn tại hay không, nên không được kết luận 404 và không được
 * nhường sang nhánh content-type. Trước đây `/api/public/pages/<slug>` nuốt lỗi
 * CSDL thành `{ ok: false }` 200 và trang này đọc nó thành 404 cho một trang có
 * thật. Lượt content-types hỏng khi trang đã chắc chắn vắng cũng vậy: chưa biết
 * slug có phải một thể loại hay không.
 */
const pageFetchFailed = computed(() => status.value === 'error')
const pageMissConfirmed = computed(() => status.value === 'success' && !(data.value?.ok && data.value?.page))
const lookupFailed = computed(() => pageFetchFailed.value || (pageMissConfirmed.value && typesStatus.value === 'error'))

const isPageBranch = computed(() => {
  if (idParam.value) return false // 2-segment → DishwasherRoute, không PageBuilder
  // Branch 1 thẳng khi page block tồn tại (data.ok + data.page), OR khi đang
  // pending/error ở lượt fetch đầu tiên để PageRenderer tự lo skeleton/error.
  // Khi data đã settle mà không có page → nhường sang Branch 2.
  const settled = status.value === 'success' || status.value === 'error'
  if (!settled) return true
  if (lookupFailed.value) return true
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
  // 2-segment: ArticleDetail/categoryList tự throw 404 khi không có bài/cat.
  if (idParam.value) return false
  // Lượt đọc hỏng chưa nói được gì về sự tồn tại của trang → không bao giờ 404.
  if (lookupFailed.value) return false
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
// 2-segment: awaited thêm catAsync để chắc CategoryView trước khi SSR ghi.
//
// Lượt đọc HỎNG (trang hoặc danh sách thể loại) → 503 + no-store thay vì 200, để
// CDN/trình duyệt không giữ trang lỗi (`utils/ssr-failure-response.ts`). Cùng biểu
// thức với nhánh lỗi (`lookupFailed` → `isPageBranch` → PageRenderer lỗi). Phía
// máy chủ setup bên dưới đã chờ mọi lượt đọc trước khi tới lượt prefetch, nên
// `settled` chỉ cần lượt đọc trang. Gọi TRƯỚC các `await` để còn ngữ cảnh Nuxt.
useSsrFailureStatus(() => asyncData, () => !idParam.value && lookupFailed.value)
// 2-segment: lượt kiểm chuyên mục hỏng → 503 + no-store (CÙNG biểu thức với nhánh
// lỗi `showCategoryLookupError`; lúc SSR không có lượt thử lại nên hai vế trùng nhau).
useSsrFailureStatus(() => catAsync, () => categoryLookupFailed.value)
if (import.meta.server) {
  await asyncData
  if (idParam.value) {
    await catAsync
  } else {
    // Chỉ fetch content-types nếu page miss (tiết kiệm truy vấn khi page hit).
    // Lượt đọc trang HỎNG không phải miss — khi đó trang hiện nhánh lỗi.
    if (pageMissConfirmed.value) {
      await typesAsync
    }
  }
  if (isMissing()) throw createError({ statusCode: 404, statusMessage: 'Không tìm thấy trang.' })
}

// Client: the document already exists, so a throw is useless — the error page is
// reached through showError instead. Runs on every settle, which also covers
// navigating between two custom slugs (the fetch re-runs via `watch: [slug]`).
if (import.meta.client) {
  watch(
    [status, data, typesStatus, typesData, catStatus, catData],
    () => {
      // 2-segment → không kết luận 404 ở đây (ArticleDetail/categoryList tự lo)
      if (idParam.value) return
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

const loadError = computed(() => error.value || (lookupFailed.value ? typesAsync.error.value : null) || null)

/** Thử lại đúng các lượt đã hỏng: trang, rồi danh sách thể loại nếu trang vắng. */
const retryLookup = async () => {
  await refresh()
  if (pageMissConfirmed.value) await typesAsync.refresh()
}

// HTML mang nhánh lỗi có thể vừa ra từ bộ đệm SWR 60 giây (lượt SSR gặp CSDL
// chập chờn) — tải lại một lần ở trình duyệt thay vì bắt khách chờ hết cửa sổ.
onMounted(() => {
  if (lookupFailed.value) void retryLookup()
})
// 2-segment: cùng lý do, cho lượt kiểm chuyên mục (nó mới quyết định nhánh).
onMounted(() => {
  if (categoryLookupFailed.value) void retryCategoryLookup()
})
const page = computed(() => data.value?.page || null)
const blocks = computed(() => previewBlocks.value ?? data.value?.blocks ?? [])
const pageHasOwnH1 = computed(() => blocksRenderOwnH1(blocks.value))

useSeoMeta({
  title: () => {
    // 2-segment category view → tên category; article detail → ArticleDetail tự set
    if (idParam.value && isCategoryView.value) {
      const cat = (catData.value?.items || []).find((c) => c.slug === idParam.value)
      return cat ? `${cat.name} | Con Đường Hướng Thiện` : seoTitle.value
    }
    return page.value?.seoTitle || (contentTypeMatch.value ? `${contentTypeMatch.value.name} | Con Đường Hướng Thiện` : `${page.value?.title || 'Trang'} | Con Đường Hướng Thiện`)
  },
  description: () => page.value?.seoDescription || contentTypeMatch.value?.description || 'Con Đường Hướng Thiện - Cục C11 Bộ Công an.',
})
</script>
