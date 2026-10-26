<template>
  <div class="bg-surface">
    <!-- Branch 1: [category] là category slug → list theo category (path segment mode) -->
    <ContentTypeListSection
      v-if="isCategoryView"
      type-slug="news"
      :type-name="t('news')"
      type-icon="fa-solid fa-newspaper"
      :type-description="''"
      :category-slug="categoryParam"
    />

    <!-- Lượt kiểm chuyên mục HỎNG: chưa biết [category] là chuyên mục hay bài —
         không rơi sang ArticleDetail (200 sai), không 404; báo lỗi + thử lại. -->
    <section v-else-if="showLookupError" class="section">
      <div class="container py-10 md:py-16">
        <BlockLoadError
          :title="t('n_load_error_title')"
          :description="t('n_load_error_desc')"
          :retry-label="t('retry')"
          :retrying="lookupRetrying"
          @retry="retryLookup"
        />
      </div>
    </section>

    <!-- Branch 2: [category] là article slug → detail bài -->
    <ArticleDetail
      v-else
      :slug="categoryParam"
      back-to="/news"
      variant="news"
      :back-label="t('a_back_news')"
      meta-icon="📰"
      :type-labels="typeLabels"
      :seo-fallback-title="t('a_news_seo_title')"
      :seo-fallback-description="t('a_news_seo_desc')"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from '~/composables/useI18n'
import { useSsrFailureStatus } from '~/composables/useSsrFailureStatus'
import { resolveCategoryRoute } from '~/utils/category-route-decision'
// Import tường minh (như các khối trang chủ): tên tự động của Nuxt là
// `BlocksBlockLoadError` — `<BlockLoadError>` không import sẽ dựng ra thẻ rỗng.
import BlockLoadError from '~/components/blocks/BlockLoadError.vue'

/**
 * Route dishwasher `/news/<X>` (1 segment):
 *  - If `X` là category slug trong type "news" → render `ContentTypeListSection`
 *    (list theo category, path segment mode). Pill category navigate
 *    `/news/<slug>`; pill "Tất cả" → `/news`.
 *  - Else (`X` là article slug) → render `ArticleDetail`.
 *
 * Tại sao dishwasher? Vì `/<type>/<X>` chỉ có 1 dynamic segment — không thể tách
 * `[category]/index.vue` (list) vs `[id].vue` (detail) mà không contest. Check
 * category trước (category win nếu trùng slug — quy tắc dữ liệu: trong 1 type,
 * slug category + article không được trùng).
 *
 * Detail article 2-segment `/news/<cat>/<article>` vẫn do `[category]/[slug].vue`
 * lo — file `[slug].vue` cùng folder này chỉ xử lý 2-segment, không contest.
 */
const { t } = useI18n()
const route = useRoute()
const categoryParam = computed(() => String(route.params.category || ''))

// Fetch categories type=news để check [category] có phải category slug không.
interface PublicCategory { id: number; name: string; slug: string; parentId: number | null }
const catAsync = useAsyncData(
  () => `news-cat-check-${categoryParam.value}`,
  () => ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; items: PublicCategory[] }>)('/api/public/categories', { query: { type: 'news' } }),
  { lazy: true, default: () => ({ ok: true, items: [] as PublicCategory[] }) },
)
const { data: catData, status: catStatus } = catAsync

// pending → ArticleDetail như cũ (bài là trường hợp phổ biến: fetch bài chạy song
// song); category → danh sách; lookup-failed → nhánh lỗi (utils/category-route-decision.ts).
const routeDecision = computed(() =>
  resolveCategoryRoute({ status: catStatus.value, data: catData.value, slug: categoryParam.value }),
)
const isCategoryView = computed(() => routeDecision.value === 'category')
const lookupFailed = computed(() => routeDecision.value === 'lookup-failed')

// Đang thử lại sau một lượt hỏng: giữ nhánh lỗi (nút quay) thay vì nhảy tạm sang
// ArticleDetail trong lúc lượt đọc mới còn bay.
const lookupRetrying = ref(false)
const showLookupError = computed(() => lookupFailed.value || (lookupRetrying.value && routeDecision.value === 'pending'))
const retryLookup = async () => {
  if (lookupRetrying.value) return
  lookupRetrying.value = true
  try {
    await catAsync.refresh()
  } finally {
    lookupRetrying.value = false
  }
}

// Lượt SSR hỏng → 503 + no-store (CÙNG biểu thức với nhánh lỗi). Gọi TRƯỚC `await`
// bên dưới để còn ngữ cảnh Nuxt.
useSsrFailureStatus(() => catAsync, () => lookupFailed.value)

// HTML mang nhánh lỗi (CSDL chập chờn lúc SSR) — thử lại một lần ở trình duyệt thay
// vì bắt khách tự bấm (cùng cách `app/pages/[slug].vue`).
onMounted(() => {
  if (lookupFailed.value) void retryLookup()
})

// Server: await category check trước khi SSR — quyết định branch + 404.
// Nếu category miss → ArticleDetail fetch + tự throw 404 khi không có bài.
// Lượt kiểm HỎNG → nhánh lỗi + 503 (không bao giờ rơi sang ArticleDetail).
if (import.meta.server) {
  await catAsync
}

const typeLabels = computed(() => ({
  news: t('a_back_news'),
  role_model: t('a_back_role'),
  reintegration: t('a_back_reintegration'),
  document: t('a_category_doc'),
  faq: t('a_category_faq'),
}))

useSeoMeta({
  title: () => {
    if (isCategoryView.value) {
      const cat = (catData.value?.items || []).find((c) => c.slug === categoryParam.value)
      return cat ? `${cat.name} | Con Đường Hướng Thiện` : 'Tin tức | Con Đường Hướng Thiện'
    }
    if (showLookupError.value) return 'Tin tức | Con Đường Hướng Thiện'
    return 'Chi tiết tin tức | Con Đường Hướng Thiện'
  },
})
</script>
