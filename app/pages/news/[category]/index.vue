<template>
  <div class="bg-[#F8FAF7]">
    <!-- Branch 1: [category] là category slug → list theo category (path segment mode) -->
    <ContentTypeListSection
      v-if="isCategoryView"
      type-slug="news"
      :type-name="t('news')"
      type-icon="fa-solid fa-newspaper"
      :type-description="''"
      :category-slug="categoryParam"
    />

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
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from '~/composables/useI18n'

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

const isCategoryView = computed(() => {
  if (catStatus.value !== 'success' && catStatus.value !== 'error') return false
  const items = catData.value?.items || []
  return items.some((c) => c.slug === categoryParam.value)
})

// Server: await category check trước khi SSR — quyết định branch + 404.
// Nếu category miss → ArticleDetail fetch + tự throw 404 khi không có bài.
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
    return 'Chi tiết tin tức | Con Đường Hướng Thiện'
  },
})
</script>
