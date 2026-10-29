<template>
  <div class="min-h-screen bg-surface">
    <!-- Page Header & Hero Section — hero text đơn giản trên nền gradient nhạt -->
    <NewsListHero
      :active-category="activeCategory"
      :active-category-name="activeCategoryName"
      :page-title="pageTitle"
    />

    <!-- Search + Category Pills — đẩy ra khỏi hero, nằm ngay đầu nội dung -->
    <section class="pt-6 lg:pt-8">
      <div class="container">
        <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <!-- Search Box -->
          <NewsSearchBox v-model="searchInput" @submit="applySearch" @clear="clearSearchInput" />

          <!-- Category Pills Filter Bar -->
          <nav aria-label="Lọc bản tin theo chuyên mục" class="flex-1 min-w-0">
            <!-- Skeleton chips — khi chuyển chuyên mục trên client -->
            <div v-if="catPending" role="status" aria-busy="true" class="flex gap-2 py-1">
              <span class="sr-only">{{ t('n_loading_categories') }}</span>
              <div
                v-for="n in 5"
                :key="n"
                aria-hidden="true"
                class="h-[34px] w-28 rounded-full bg-line animate-pulse motion-reduce:animate-none"
              ></div>
            </div>

            <NewsCategoryPills
              v-else
              :active-category="activeCategory"
              :root-categories="rootCategories"
              :active-children="activeChildren"
              @select="setCategory"
            />
          </nav>
        </div>
      </div>
    </section>

    <!-- Main Content Section -->
    <section class="py-8 lg:py-10">
      <div class="container grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_330px] xl:grid-cols-[minmax(0,1fr)_350px] lg:gap-8 xl:gap-10 lg:items-start">
        <!-- Main News Column (Left) -->
        <div class="flex flex-col gap-7 min-w-0">
          <!-- Mỏ neo cuộn trang khi phân trang hoặc lọc -->
          <div id="news-list-top" class="scroll-mt-[100px]"></div>

          <!-- Active Search Filter Banner -->
          <div
            v-if="searchQuery"
            class="bg-white border-l-4 border-l-brand-600 border border-line p-4 rounded-xl shadow-sm flex items-center justify-between gap-3 flex-wrap"
          >
            <div class="flex items-center gap-2.5">
              <span class="w-7 h-7 rounded-lg bg-line text-brand-600 flex items-center justify-center text-xs">
                <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
              </span>
              <span class="text-sm text-[#3E4D3C]">
                {{ t('n_search_result') }} <strong>&laquo;{{ searchQuery }}&raquo;</strong>
                <!-- Không đếm khi lượt đọc hỏng: Nuxt đã đặt danh sách về rỗng, "(0 bài viết)"
                     sẽ nói dối ngay trên thẻ lỗi (FINDING-N2). -->
                <span v-if="!pending && !loadError" class="text-ink-soft ml-1.5">({{ t('n_articles_count').replace('{n}', String(pagination.total)) }})</span>
              </span>
            </div>
            <button
              type="button"
              class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#D5E1D3] bg-surface hover:bg-line text-xs font-bold text-brand-600 transition-all"
              @click="clearSearch"
            >
              <i class="fa-solid fa-xmark text-[0.7rem]" aria-hidden="true"></i>
              <span>{{ t('n_clear_filter') }}</span>
            </button>
          </div>

          <!-- Loading State (Skeleton) -->
          <div v-if="pending" role="status" aria-busy="true" class="flex flex-col gap-8">
            <span class="sr-only">{{ t('n_list_loading') }}</span>
            <!-- Hero skeleton -->
            <div aria-hidden="true" class="bg-white overflow-hidden border border-line shadow-sm flex flex-col md:flex-row animate-pulse motion-reduce:animate-none">
              <div class="md:w-[48%] aspect-video bg-line shrink-0 rounded-none"></div>
              <div class="p-6 md:p-8 flex flex-col justify-between md:w-[52%] gap-4">
                <div class="flex items-center gap-3">
                  <div class="h-5 w-24 bg-line rounded-full"></div>
                  <div class="h-4 w-28 bg-line rounded"></div>
                </div>
                <div class="space-y-2">
                  <div class="h-6 w-full bg-line rounded"></div>
                  <div class="h-6 w-3/4 bg-line rounded"></div>
                </div>
                <div class="space-y-2">
                  <div class="h-3.5 w-full bg-line rounded"></div>
                  <div class="h-3.5 w-5/6 bg-line rounded"></div>
                </div>
                <div class="h-8 w-32 bg-line rounded-lg mt-2"></div>
              </div>
            </div>

            <!-- Grid skeleton (6 cards) -->
            <div aria-hidden="true" class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
              <div v-for="n in 6" :key="n" class="bg-white overflow-hidden border border-line shadow-sm animate-pulse motion-reduce:animate-none flex flex-col">
                <div class="w-full aspect-video bg-line rounded-none"></div>
                <div class="p-5 flex flex-col gap-3 flex-1">
                  <div class="h-3.5 w-24 bg-line rounded"></div>
                  <div class="h-5 w-full bg-line rounded"></div>
                  <div class="h-5 w-2/3 bg-line rounded"></div>
                  <div class="h-3.5 w-full bg-line rounded mt-1"></div>
                  <div class="h-3.5 w-4/5 bg-line rounded"></div>
                </div>
              </div>
            </div>
          </div>

          <!-- Error State -->
          <div
            v-else-if="loadError"
            role="alert"
            class="bg-white border-2 border-dashed border-[#F0B8B8] px-6 py-12 rounded-2xl text-center text-danger-soft shadow-sm"
          >
            <div class="w-12 h-12 rounded-full bg-danger-bg text-[#C62828] flex items-center justify-center mx-auto mb-3 text-lg">
              <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
            </div>
            <h3 class="text-base font-extrabold text-[#992222] m-0 mb-1">{{ t('n_load_error_title') }}</h3>
            <p class="text-sm text-ink-muted m-0 mb-4">{{ t('n_load_error_desc') }}</p>
            <button
              type="button"
              class="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-800 text-white font-bold text-sm transition-all shadow-sm"
              @click="refresh()"
            >
              <i class="fa-solid fa-rotate-right text-xs" aria-hidden="true"></i>
              <span>{{ t('n_retry_now') }}</span>
            </button>
          </div>

          <!-- Empty State -->
          <div
            v-else-if="newsList.length === 0"
            class="bg-white border-2 border-dashed border-line px-6 py-14 rounded-2xl text-center shadow-sm"
          >
            <div class="w-14 h-14 rounded-full bg-surface-tint text-brand-600 flex items-center justify-center mx-auto mb-3.5 text-xl">
              <i class="fa-regular fa-newspaper" aria-hidden="true"></i>
            </div>
            <template v-if="pageOutOfRange">
              <!-- `?page=` vượt trang cuối (link cũ, gõ tay): không phải "chưa có bài" —
                   đưa người đọc về trang đầu thay vì để kẹt ở một trang trắng. -->
              <p class="text-sm text-[#6E7D6B] max-w-md mx-auto m-0 mb-5">{{ t('list_page_out_of_range').replace('{total}', String(pagination.totalPages)) }}</p>
              <button
                type="button"
                class="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-800 text-white font-bold text-sm transition-all shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                @click="goFirstPage"
              >
                <i class="fa-solid fa-arrow-left text-xs" aria-hidden="true"></i>
                <span>{{ t('list_back_first_page') }}</span>
              </button>
            </template>
            <template v-else>
              <h3 class="text-base font-extrabold text-[#233520] m-0 mb-1">{{ t('n_empty_title') }}</h3>
              <p class="text-sm text-[#6E7D6B] max-w-md mx-auto m-0 mb-5">
                {{ t('n_empty_desc2') }}
              </p>
              <button
                type="button"
                class="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-800 text-white font-bold text-sm transition-all shadow-sm"
                @click="resetFilter"
              >
                <i class="fa-solid fa-arrow-rotate-left text-xs" aria-hidden="true"></i>
                <span>{{ t('n_view_all_list') }}</span>
              </button>
            </template>
          </div>

          <!-- Content Render -->
          <template v-else>
            <!-- Featured / Lead Article -->
            <NewsFeaturedCard v-if="featured" :item="featured" />

            <!-- List header + 3-column magazine grid (each renders only when there are cards) -->
            <NewsArticleGrid
              :items="rest"
              :total="pagination.total"
              :page="pagination.page"
              :total-pages="pagination.totalPages"
              :grid-class="articleGridClass"
            />
            <!-- Enhanced Pagination -->
            <NewsPagination
              v-if="pagination.totalPages > 1"
              :page="pagination.page"
              :total-pages="pagination.totalPages"
              :page-range="pageRange"
              @go="setPage"
            />
          </template>
        </div>

        <!-- Right Rail / Sidebar (Right) -->
        <aside class="flex flex-col gap-6 min-w-0 lg:sticky lg:top-[90px]">
          <!-- Widget 1: Đọc nhiều (thiết kế nguyên bản tinh tế) -->
          <div class="bg-white rounded-lg border border-line shadow-sm px-5 py-2">
            <h2 class="text-[0.8rem] font-extrabold text-brand-600 uppercase tracking-[0.6px] pt-3 pb-2 border-b-2 border-line m-0">{{ t('n_most_read_short') }}</h2>

            <div v-if="mostReadPending" role="status" aria-busy="true" class="py-2">
              <span class="sr-only">{{ t('n_loading_most_read') }}</span>
              <div aria-hidden="true" class="flex flex-col">
                <div v-for="n in 6" :key="n" class="flex gap-3 py-3 border-b border-line last:border-b-0">
                  <div class="h-6 w-6 bg-surface-tint rounded shrink-0 animate-pulse motion-reduce:animate-none"></div>
                  <div class="flex-1 flex flex-col gap-1.5 pt-0.5">
                    <div class="h-3.5 w-full bg-surface-tint rounded animate-pulse motion-reduce:animate-none"></div>
                    <div class="h-3.5 w-2/3 bg-surface-tint rounded animate-pulse motion-reduce:animate-none"></div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Hỏng ≠ "chưa có dữ liệu lượt xem" (FINDING-N3): nói là hỏng, cho thử lại riêng khối này. -->
            <p v-else-if="mostReadFailed" role="alert" class="text-[0.85rem] text-danger-soft py-4 m-0">
              {{ t('n_load_error_desc') }}
              <button type="button" class="font-bold text-brand-600 underline" @click="retryMostRead()">{{ t('retry') }}</button>
            </p>

            <NewsMostReadList v-else-if="mostRead.length" :items="mostRead" />

            <p v-else class="text-[0.85rem] text-ink-soft italic py-4 m-0">{{ t('n_no_views') }}</p>
          </div>

          <!-- Widget 2: Chuyên mục bản tin -->
          <NewsCategoryWidget
            v-if="rootCategories.length"
            :active-category="activeCategory"
            :categories="rootCategories"
            @select="setCategory"
          />

          <!-- Widget 3: Hotline & Hỗ Trợ 24/7 -->
          <NewsHotlineWidget />

          <!-- Widget 4: Tra cứu nhanh -->
          <NewsQuickLinksWidget />
        </aside>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
/**
 * `/news` — the public news list.
 *
 * Split in wave3 4.2 (724 lines → this file + `components/news/*`). Kept here: every
 * request (the list and "Đọc nhiều" through usePublicArticleList, the categories — its
 * `$fetch` cast stays here: there is no public typed fetch helper), the category tree, the
 * search banner, the loading / error + retry / empty / out-of-range branches of the list,
 * the loading chips of the filter bar and the skeleton + empty line of "Đọc nhiều". The
 * parts render only: hero (the page's one `<h1>`), search box (`v-model`), category chips,
 * lead story, list header + grid, pagination, the loaded "Đọc nhiều" list and three rail
 * widgets. They emit; navigation stays in the composable.
 */
import { computed } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useLayoutConfig } from '~/composables/useLayoutConfig'
import { usePublicArticleList, usePublicMostRead } from '~/composables/usePublicArticleList'
import NewsListHero from '~/components/news/NewsListHero.vue'
import NewsSearchBox from '~/components/news/NewsSearchBox.vue'
import NewsCategoryPills from '~/components/news/NewsCategoryPills.vue'
import NewsFeaturedCard from '~/components/news/NewsFeaturedCard.vue'
import NewsArticleGrid from '~/components/news/NewsArticleGrid.vue'
import NewsPagination from '~/components/news/NewsPagination.vue'
import NewsMostReadList from '~/components/news/NewsMostReadList.vue'
import NewsCategoryWidget from '~/components/news/NewsCategoryWidget.vue'
import NewsHotlineWidget from '~/components/news/NewsHotlineWidget.vue'
import NewsQuickLinksWidget from '~/components/news/NewsQuickLinksWidget.vue'

const { t, currentLang } = useI18n()
const { articleGridClass } = useLayoutConfig()

useSeoMeta({
  title: () => `${t('n_activity_heading')} | Con Đường Hướng Thiện`,
  description: () => t('n_index_desc')
})

// Danh sách + phân trang + tìm kiếm: trạng thái đọc từ URL, khoá fetch dẫn xuất
// từ query (xem usePublicArticleList). Chuyên mục khác "all" sống ở path
// `/news/<cat>` (route `news/[category]/index.vue`); `?cat=` chỉ còn cho link cũ.
const {
  activeCategory,
  searchQuery,
  searchInput,
  articles: newsList,
  pagination,
  pageRange,
  pageOutOfRange,
  pending,
  loadError,
  refresh,
  featured,
  rest,
  setPage,
  goFirstPage,
  setCategory,
  applySearch,
  clearSearch,
  clearSearchInput,
  resetFilter,
} = usePublicArticleList({
  type: 'news',
  perPage: 19,
  lang: currentLang,
  withCategory: true,
  pathFor: (category) => (category === 'all' ? '/news' : `/news/${category}`),
  scrollTargetId: 'news-list-top',
})

const { mostRead, mostReadPending, mostReadFailed, retryMostRead } = usePublicMostRead('news', currentLang)

// Category chips — DB-driven via /api/public/categories?type=news
// Tên chuyên mục theo ngôn ngữ (FINDING-N1): `lang` đi trong query — `$fetch` lúc dựng phía
// máy chủ không mang cookie `cdkt_lang`, máy chủ chỉ biết qua tham số — và có trong khoá,
// nên đổi ngôn ngữ là đọc lại (cùng cách ContentTypeListSection và "Đọc nhiều").
const { data: catData, pending: catPending } = useAsyncData(() => `news-categories-${currentLang.value}`, () =>
  ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; items: Array<{ id: number; name: string; slug: string; parentId: number | null }> }>)('/api/public/categories', { query: { type: 'news', lang: currentLang.value } }),
  {
    lazy: true,
    default: () => ({ ok: true, items: [] })
  }
)
const allCategories = computed(() => catData.value?.items || [])
const rootCategories = computed(() => allCategories.value.filter((c) => c.parentId === null))
const childrenOf = (parentId: number) => allCategories.value.filter((c) => c.parentId === parentId)

const activeRoot = computed(() => {
  if (activeCategory.value === 'all') return null
  const direct = allCategories.value.find((c) => c.slug === activeCategory.value)
  if (!direct) return null
  if (direct.parentId === null) return direct
  return allCategories.value.find((c) => c.id === direct.parentId) ?? null
})
const activeChildren = computed(() => (activeRoot.value ? childrenOf(activeRoot.value.id) : []))

const activeCategoryName = computed(() => {
  if (activeCategory.value === 'all') return ''
  return allCategories.value.find((c) => c.slug === activeCategory.value)?.name ?? ''
})

const pageTitle = computed(() => {
  if (activeCategory.value === 'all') return t('n_activity_heading')
  return activeCategoryName.value || t('n_activity_heading')
})
</script>
