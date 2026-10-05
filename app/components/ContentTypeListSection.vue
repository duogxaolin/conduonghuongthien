<script setup lang="ts">
import type { PublicArticleListItem, PublicPagination } from '~/utils/public-types'
import { useI18n } from '~/composables/useI18n'
import { computed, ref, watch } from 'vue'
import { useRoute, navigateTo } from '#imports'
import { formatDateVN } from '~/utils/formatDate'

/**
 * Trang list bài cho một Content-Type custom (type tạo qua /admin/content/content-types,
 * không có route tĩnh riêng như /news hay /role-models). Cũng dùng cho category list
 * path segment `/<type>/<category-slug>` (route dishwasher parent `[slug].vue`).
 *
 * Tham chiếu UI `/news` (app/pages/news/index.vue): hero (PageHero) + search box +
 * category pills (root) + sub-pills (children) + featured bài tiêu điểm + grid
 * 3 cột + sidebar most-read + category widget + hotline + quick-tools + pagination.
 *
 * Filter category dùng **path segment** `/<type>/<category-slug>` (route dishwasher
 * parent `[slug].vue` differentiate category vs article qua `route.params.id`).
 * API `/api/public/articles` nhận `categorySlug` + xử lý root include children.
 * Link cũ `?cat=` redirect 301 sang path segment (server middleware).
 */
const props = defineProps({
  /** Slug của content-type (khóa `type` trong bảng articles). */
  typeSlug: { type: String, required: true },
  /** Tên hiển thị của content-type (lấy từ content-types API). */
  typeName: { type: String, default: '' },
  /** Icon FontAwesome class của content-type. */
  typeIcon: { type: String, default: '' },
  /** Mô tả content-type — làm subheading. */
  typeDescription: { type: String, default: '' },
  /**
   * Category slug active khi dùng path segment `/<type>/<category>` (route
   * dishwasher parent `[slug].vue`). Khi prop này set, component bỏ qua
   * `route.query.cat` và `setCategory` navigate path segment. Default undefined
   * → dùng `route.query.cat` (backward compat link cũ, sẽ redirect 301).
   */
  categorySlug: { type: String, default: undefined },
})

const { t, currentLang } = useI18n()
const route = useRoute()

interface PublicCategory {
  id: number
  name: string
  slug: string
  parentId: number | null
}

// ─── Category pills (DB-driven via /api/public/categories?type=<slug>) ─────────
const { data: catData, pending: catPending } = await useAsyncData(
  () => `content-type-cats-${props.typeSlug}-${currentLang.value}`,
  () => ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; items: PublicCategory[] }>)('/api/public/categories', {
    query: { type: props.typeSlug, lang: currentLang.value },
  }),
  {
    lazy: true,
    default: () => ({ ok: true, items: [] as PublicCategory[] }),
    watch: [() => props.typeSlug, currentLang],
  },
)
const allCategories = computed(() => catData.value?.items || [])
const rootCategories = computed(() => allCategories.value.filter((c) => c.parentId === null))
const childrenOf = (parentId: number) => allCategories.value.filter((c) => c.parentId === parentId)

// categorySlug prop (path segment mode) override query.cat.
const activeCategory = ref(props.categorySlug ?? String(route.query.cat || 'all'))

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
  const cat = allCategories.value.find((c) => c.slug === activeCategory.value)
  return cat?.name || ''
})
const pageTitle = computed(() => {
  if (activeCategory.value !== 'all' && activeCategoryName.value) return activeCategoryName.value
  return props.typeName || props.typeSlug
})

// Hero description — chỉ hiện ở list-all (không phải category). Guard `null`/`undefined`
// và cả literal string "null" (data cũ nhập text "null" được lưu thay vì SQL NULL).
const heroDescription = computed(() => {
  if (activeCategory.value !== 'all') return ''
  const d = String(props.typeDescription || '').trim()
  if (!d || d.toLowerCase() === 'null') return ''
  return d
})

// ─── Search ────────────────────────────────────────────────────────────────────
const searchQuery = ref(String(route.query.q || ''))
const searchInput = ref(searchQuery.value)
const PER_PAGE = 19
const currentPage = ref(Math.max(1, Math.floor(Number(route.query.page) || 1) || 1))

const applySearch = () => {
  searchQuery.value = searchInput.value.trim()
  currentPage.value = 1
  syncUrl()
}
const clearSearchInput = () => {
  searchInput.value = ''
  searchQuery.value = ''
  currentPage.value = 1
  syncUrl()
}

// ─── Article list ──────────────────────────────────────────────────────────────
const page = computed(() => {
  const n = Number(route.query.page)
  return Number.isSafeInteger(n) && n > 0 ? n : 1
})

interface ListResponse {
  ok: boolean
  articles: PublicArticleListItem[]
  pagination: PublicPagination
}

const { data, pending, error, refresh } = await useAsyncData(
  () => `content-type-list-${props.typeSlug}-${page.value}-${activeCategory.value}-${searchQuery.value}-${currentLang.value}`,
  () => ($fetch as (u: string, o?: Record<string, unknown>) => Promise<ListResponse>)('/api/public/articles', {
    query: {
      type: props.typeSlug,
      page: page.value,
      limit: PER_PAGE,
      lang: currentLang.value,
      ...(searchQuery.value ? { search: searchQuery.value } : {}),
      ...(activeCategory.value !== 'all' ? { categorySlug: activeCategory.value } : {}),
    },
  }),
  {
    lazy: true,
    default: () => ({ ok: true, articles: [], pagination: { page: 1, limit: PER_PAGE, total: 0, totalPages: 0 } }),
    watch: [() => props.typeSlug, page, activeCategory, searchQuery, currentLang],
  },
)

const articles = computed(() => (data.value as ListResponse | null)?.articles || [])
const loadError = computed(() => !!error.value || (data.value as { ok?: boolean } | null)?.ok === false)
const pagination = computed(() => (data.value as ListResponse | null)?.pagination || { page: 1, limit: PER_PAGE, total: 0, totalPages: 0 })

// Featured & Rest — chỉ hiện bài tiêu điểm ở Trang 1 khi không tìm kiếm
const isLeadPage = computed(() => page.value === 1 && !searchQuery.value)
const featured = computed(() => (isLeadPage.value ? articles.value[0] ?? null : null))
const restArticles = computed(() => (isLeadPage.value ? articles.value.slice(1) : articles.value))

// Most Read (sort=views) — generic theo type
const { data: mostReadData, pending: mostReadPending } = await useAsyncData(
  () => `content-type-most-read-${props.typeSlug}-${currentLang.value}`,
  () => ($fetch as (u: string, o?: Record<string, unknown>) => Promise<ListResponse>)('/api/public/articles', {
    query: { type: props.typeSlug, limit: 6, sort: 'views', lang: currentLang.value },
  }),
  {
    lazy: true,
    default: () => ({ ok: true, articles: [], pagination: { page: 1, limit: 6, total: 0, totalPages: 0 } }),
    watch: [() => props.typeSlug, currentLang],
  },
)
const mostRead = computed(() => (mostReadData.value as ListResponse | null)?.articles || [])

// ─── Navigation (path segment /<type>/<cat>, giữ ?page + ?q) ───────────────────
const setCategory = (cat: string) => {
  activeCategory.value = cat
  currentPage.value = 1
  syncUrl()
}

const syncUrl = () => {
  const path = activeCategory.value === 'all' ? `/${props.typeSlug}` : `/${props.typeSlug}/${activeCategory.value}`
  const query: { page?: number; q?: string } = {}
  if (searchQuery.value) query.q = searchQuery.value
  if (currentPage.value > 1) query.page = currentPage.value
  navigateTo({ path, query })
}

// Khi route.query.cat/q/page hoặc props.categorySlug đổi, sync state.
watch(() => [route.query.cat, route.query.q, route.query.page, props.categorySlug], () => {
  activeCategory.value = props.categorySlug ?? String(route.query.cat || 'all')
  searchQuery.value = String(route.query.q || '')
  searchInput.value = searchQuery.value
  currentPage.value = Math.max(1, Math.floor(Number(route.query.page) || 1) || 1)
})

// Helper pagination: path segment + ?page/?q query.
const pagePath = (n: number) => {
  const path = activeCategory.value === 'all' ? `/${props.typeSlug}` : `/${props.typeSlug}/${activeCategory.value}`
  const query: { page?: number; q?: string } = {}
  if (searchQuery.value) query.q = searchQuery.value
  if (n > 1) query.page = n
  return query.page || query.q ? { path, query } : path
}

const formatDate = (item: { publishedAt?: string | null; createdAt?: string | null }) =>
  formatDateVN(item.publishedAt || item.createdAt)

const cleanExcerpt = (text: string | null) => (text || '').replace(/<[^>]+>/g, '').trim()

const typeLink = (slug: string) => `/${props.typeSlug}/${slug}`

// Visual pill classes (tham chiếu news/index.vue)
const pillClass = (active: boolean) => [
  'inline-flex items-center gap-2 shrink-0 whitespace-nowrap rounded-full border cursor-pointer px-4 py-2 text-[0.82rem] font-bold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A6741]',
  active
    ? 'bg-[#4A6741] border-[#4A6741] text-white shadow-sm shadow-[#4A6741]/25'
    : 'bg-white border-[#D5E1D3] text-[#485645] hover:border-[#4A6741] hover:text-[#385932] hover:bg-[#F2F7F0]',
]
const subPillClass = (active: boolean) => [
  'shrink-0 whitespace-nowrap rounded-lg border cursor-pointer px-3 py-1 font-bold transition-all duration-200 text-xs',
  active
    ? 'bg-[#385932] border-[#385932] text-white shadow-sm'
    : 'bg-white border-[#DDE6DC] text-[#556350] hover:border-[#385932] hover:text-[#385932] hover:bg-[#F0F5EE]',
]
const categoryIcon = (_slug: string) => 'fa-solid fa-folder'
</script>

<template>
  <div class="min-h-screen bg-[#F7FAF6]">
    <!-- Page Header & Hero Section -->
    <PageHero>
      <nav aria-label="Đường dẫn trang" class="mb-4">
        <ol class="flex items-center gap-1.5 text-xs text-[#6B7967] m-0 p-0 list-none flex-wrap">
          <li class="flex items-center gap-1.5">
            <nuxt-link to="/" class="hover:text-[#385932] transition-colors flex items-center gap-1 no-underline text-[#556450]">
              <i class="fa-solid fa-house text-[0.7rem] text-[#4A6741]" aria-hidden="true"></i>
              <span>{{ t('home') }}</span>
            </nuxt-link>
          </li>
          <li aria-hidden="true" class="text-[#A2B09F]">&rsaquo;</li>
          <li class="font-bold text-[#2A3B27] flex items-center gap-1">
            <span>{{ typeName || typeSlug }}</span>
            <span v-if="activeCategory !== 'all' && activeCategoryName" class="font-normal text-[#6B7967]">
              &rsaquo; <span class="font-bold text-[#2A3B27]">{{ activeCategoryName }}</span>
            </span>
          </li>
        </ol>
      </nav>

      <div class="max-w-2xl">
        <div class="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#E4EEE2] border border-[#D0DFCE] text-[#365730] text-[0.72rem] font-extrabold uppercase tracking-wider mb-2.5 shadow-sm">
          <span class="w-2 h-2 rounded-full bg-[#4A6741] animate-pulse motion-reduce:animate-none" aria-hidden="true"></span>
          <span>{{ t('n_portal_badge') }}</span>
        </div>
        <h1 class="text-2xl sm:text-3xl lg:text-[2.2rem] font-black text-[#172516] tracking-tight leading-[1.2] m-0">
          {{ pageTitle }}
        </h1>
        <p v-if="heroDescription" class="text-[0.92rem] sm:text-base text-[#576653] mt-2 mb-0 leading-relaxed">
          {{ heroDescription }}
        </p>
      </div>
    </PageHero>

    <!-- Search + Category Pills -->
    <section class="pt-6 lg:pt-8">
      <div class="container">
        <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <!-- Search Box -->
          <div class="w-full lg:w-80 shrink-0">
            <form @submit.prevent="applySearch" class="relative flex items-center">
              <span class="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#7C8D78] pointer-events-none text-xs">
                <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
              </span>
              <input
                v-model="searchInput"
                type="text"
                :placeholder="t('n_search_placeholder')"
                :aria-label="t('n_search_placeholder')"
                class="w-full pl-9 pr-20 py-2.5 bg-white rounded-xl border border-[#D5E1D3] text-sm text-[#1E251C] placeholder-[#8A9986] focus:border-[#4A6741] focus:ring-2 focus:ring-[#7CB342]/30 focus:outline-none transition-all shadow-sm"
              />
              <button
                v-if="searchInput"
                type="button"
                @click="clearSearchInput"
                class="absolute right-12 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center text-[#97A593] hover:text-[#4A5545] text-xs transition-colors"
                :title="t('clear_search')"
                :aria-label="t('clear_search')"
              >✕</button>
              <button
                type="submit"
                class="absolute right-1.5 top-1/2 -translate-y-1/2 px-3 py-1.5 rounded-lg bg-[#4A6741] hover:bg-[#365130] text-white text-xs font-bold transition-all shadow-sm"
              >{{ t('n_search_btn_short') }}</button>
            </form>
          </div>

          <!-- Category Pills Filter Bar -->
          <nav :aria-label="`Lọc ${typeName} theo danh mục`" class="flex-1 min-w-0">
            <div v-if="catPending" role="status" aria-busy="true" class="flex gap-2 py-1">
              <span class="sr-only">{{ t('n_loading_categories') }}</span>
              <div v-for="n in 5" :key="n" aria-hidden="true" class="h-[34px] w-28 rounded-full bg-[#E2EBE0] animate-pulse motion-reduce:animate-none"></div>
            </div>
            <template v-else>
              <div class="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none flex-wrap">
                <button
                  type="button"
                  :aria-pressed="activeCategory === 'all'"
                  :class="pillClass(activeCategory === 'all')"
                  @click="setCategory('all')"
                >
                  <i class="fa-solid fa-layer-group text-xs" aria-hidden="true"></i>
                  <span>{{ t('n_all_news') }}</span>
                </button>
                <button
                  v-for="cat in rootCategories"
                  :key="cat.id"
                  type="button"
                  :aria-pressed="activeCategory === cat.slug"
                  :class="pillClass(activeCategory === cat.slug)"
                  @click="setCategory(cat.slug)"
                >
                  <i :class="categoryIcon(cat.slug)" aria-hidden="true"></i>
                  <span>{{ cat.name }}</span>
                </button>
              </div>
              <div v-if="activeChildren.length" class="flex items-center gap-2 overflow-x-auto pt-2.5 pb-1 sm:flex-wrap text-xs">
                <span class="text-[#7A8A76] font-semibold flex items-center gap-1 shrink-0">
                  <i class="fa-solid fa-turn-down text-[0.65rem] rotate-[-90deg]" aria-hidden="true"></i>
                  {{ t('n_subtopic') }}
                </span>
                <button
                  v-for="child in activeChildren"
                  :key="child.id"
                  type="button"
                  :aria-pressed="activeCategory === child.slug"
                  :class="subPillClass(activeCategory === child.slug)"
                  @click="setCategory(child.slug)"
                >{{ child.name }}</button>
              </div>
            </template>
          </nav>
        </div>
      </div>
    </section>

    <!-- Main Content Section -->
    <section class="py-8 lg:py-10">
      <div class="container grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_330px] xl:grid-cols-[minmax(0,1fr)_350px] lg:gap-8 xl:gap-10 lg:items-start">
        <!-- Main Column (Left) -->
        <div class="flex flex-col gap-7 min-w-0">
          <div :id="`list-top-${typeSlug}`" class="scroll-mt-[100px]"></div>

          <!-- Active Search Filter Banner -->
          <div
            v-if="searchQuery"
            class="bg-white border-l-4 border-l-[#4A6741] border border-[#DDE6DC] p-4 rounded-xl shadow-sm flex items-center justify-between gap-3 flex-wrap"
          >
            <div class="flex items-center gap-2.5">
              <span class="w-7 h-7 rounded-lg bg-[#EBF3E8] text-[#4A6741] flex items-center justify-center text-xs">
                <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
              </span>
              <span class="text-sm text-[#3E4D3C]">
                {{ t('n_search_result') }} <strong>&laquo;{{ searchQuery }}&raquo;</strong>
                <span v-if="!pending" class="text-[#7A8A76] ml-1.5">({{ t('n_articles_count').replace('{n}', String(pagination.total)) }})</span>
              </span>
            </div>
            <button
              type="button"
              class="text-xs font-bold text-[#4A6741] hover:text-[#2D5A27] flex items-center gap-1 cursor-pointer"
              @click="clearSearchInput"
            >
              <i class="fa-solid fa-xmark" aria-hidden="true"></i>
              <span>{{ t('n_clear_filter') }}</span>
            </button>
          </div>

          <!-- Loading (Skeleton) -->
          <div v-if="pending" role="status" aria-busy="true" class="flex flex-col gap-5">
            <span class="sr-only">{{ t('n_list_loading') }}</span>
            <!-- Featured skeleton -->
            <div class="bg-white rounded-2xl overflow-hidden border border-[#E2E8DF] shadow-sm flex flex-col sm:flex-row animate-pulse motion-reduce:animate-none">
              <div class="sm:w-[45%] aspect-video sm:aspect-auto bg-[#EEF2EC]"></div>
              <div class="p-5 sm:p-6 flex flex-col gap-3 flex-1">
                <div class="h-3 w-20 bg-[#EEF2EC] rounded"></div>
                <div class="h-6 w-full bg-[#EEF2EC] rounded"></div>
                <div class="h-3.5 w-full bg-[#EEF2EC] rounded"></div>
                <div class="h-3.5 w-2/3 bg-[#EEF2EC] rounded"></div>
              </div>
            </div>
            <!-- Grid skeleton (6 cards) -->
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              <div v-for="n in 6" :key="n" class="bg-white rounded-2xl overflow-hidden border border-[#E2E8DF] shadow-sm animate-pulse motion-reduce:animate-none flex flex-col">
                <div class="aspect-video bg-[#EEF2EC]"></div>
                <div class="p-4 sm:p-5 flex flex-col gap-3 flex-1">
                  <div class="h-3.5 w-24 bg-[#EEF2EC] rounded"></div>
                  <div class="h-5 w-full bg-[#EEF2EC] rounded"></div>
                  <div class="h-3.5 w-full bg-[#EEF2EC] rounded"></div>
                  <div class="h-3.5 w-2/3 bg-[#EEF2EC] rounded"></div>
                </div>
              </div>
            </div>
          </div>

          <!-- Error -->
          <div
            v-else-if="loadError"
            role="alert"
            class="bg-white border border-[#E2A0A0] rounded-2xl p-8 text-center shadow-sm"
          >
            <div class="w-14 h-14 rounded-full bg-[#FDECEC] text-[#D14040] flex items-center justify-center mx-auto mb-3 text-2xl">
              <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
            </div>
            <h3 class="text-base font-extrabold text-[#172516] m-0 mb-2">{{ t('n_load_error') }}</h3>
            <p class="text-sm text-[#667768] m-0 mb-4">{{ t('n_load_error_desc') }}</p>
            <button
              type="button"
              class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#4A6741] text-white text-xs font-bold hover:bg-[#385132] transition-all cursor-pointer border-none"
              @click="() => refresh()"
            >
              <i class="fa-solid fa-rotate-right" aria-hidden="true"></i>
              <span>{{ t('retry') }}</span>
            </button>
          </div>

          <!-- Empty State -->
          <div
            v-else-if="articles.length === 0"
            class="bg-white border border-[#E2E8DF] rounded-2xl p-10 text-center shadow-sm"
          >
            <div class="w-16 h-16 rounded-full bg-[#EBF3E8] text-[#4A6741] flex items-center justify-center mx-auto mb-4 text-2xl">
              <i :class="typeIcon || 'fa-regular fa-newspaper'" aria-hidden="true"></i>
            </div>
            <h3 class="text-lg font-extrabold text-[#172516] m-0 mb-2">{{ t('n_empty') }}</h3>
            <p class="text-sm text-[#556450] m-0">{{ t('n_empty_desc') }}</p>
          </div>

          <!-- Content -->
          <template v-else>
            <!-- Featured / Lead Article -->
            <article
              v-if="featured"
              class="group bg-white rounded-2xl overflow-hidden border border-[#E2E8DF] shadow-[0_3px_12px_rgba(0,0,0,0.04)] hover:shadow-[0_10px_28px_rgba(74,103,65,0.14)] transition-all duration-300 flex flex-col sm:flex-row"
            >
              <nuxt-link :to="typeLink(featured.slug)" class="block relative sm:w-[45%] aspect-video sm:aspect-auto overflow-hidden bg-[#EEF4EC] no-underline shrink-0">
                <img
                  :src="featured.thumbnailUrl || '/assets/hero_banner.jpg'"
                  :alt="featured.title"
                  loading="eager"
                  class="w-full h-full object-cover object-center transition-transform duration-500 ease-out group-hover:scale-105"
                />
              </nuxt-link>
              <div class="p-5 sm:p-6 flex flex-col flex-1 justify-center">
                <div class="flex items-center gap-2 mb-2.5">
                  <span class="inline-flex items-center gap-1.5 bg-[#FDE8C8] text-[#A85A1A] text-[0.68rem] font-extrabold px-2.5 py-1 rounded-full uppercase tracking-wider">
                    <i class="fa-solid fa-star" aria-hidden="true"></i>
                    {{ t('n_featured_badge') }}
                  </span>
                  <span v-if="featured.categoryName" class="inline-block bg-[#EEF4EC] text-[#3A6033] font-bold text-[0.68rem] px-2 py-0.5 rounded uppercase tracking-wider">
                    {{ featured.categoryName }}
                  </span>
                  <span class="text-[#889684] text-[0.75rem] flex items-center gap-1">
                    <i class="fa-regular fa-calendar-days text-[0.72rem]" aria-hidden="true"></i>
                    {{ formatDate(featured) }}
                  </span>
                </div>
                <h2 class="text-lg sm:text-xl lg:text-[1.5rem] font-extrabold leading-[1.3] text-[#172516] group-hover:text-[#2D5A27] transition-colors duration-200 mb-2 m-0">
                  <nuxt-link :to="typeLink(featured.slug)" class="text-inherit no-underline">{{ featured.title }}</nuxt-link>
                </h2>
                <p v-if="featured.excerpt" class="text-[0.88rem] text-[#556450] leading-relaxed m-0 line-clamp-2 mb-3">
                  {{ cleanExcerpt(featured.excerpt) }}
                </p>
                <nuxt-link
                  :to="typeLink(featured.slug)"
                  class="inline-flex items-center gap-1.5 font-bold text-[#385932] hover:text-[#1B3617] text-sm group-hover:translate-x-0.5 transition-all no-underline w-fit"
                >
                  <span>{{ t('view_details') }}</span>
                  <i class="fa-solid fa-arrow-right text-[0.72rem] transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true"></i>
                </nuxt-link>
              </div>
            </article>

            <!-- Section Title Divider -->
            <div v-if="restArticles.length" class="flex items-center justify-between pt-1 pb-3 border-b-2 border-[#E1EADF] mb-1">
              <div class="flex items-center gap-2.5">
                <span class="w-2.5 h-6 rounded-sm bg-[#4A6741]" aria-hidden="true"></span>
                <h2 class="text-base sm:text-lg font-black text-[#1A2A17] tracking-tight uppercase m-0">
                  {{ pageTitle }}
                </h2>
                <span class="text-xs font-extrabold px-2.5 py-0.5 rounded-full bg-[#EBF3E8] text-[#385932]">
                  {{ t('n_count_suffix').replace('{n}', String(restArticles.length)) }}
                </span>
              </div>
            </div>

            <!-- Responsive 3-Column Magazine Grid -->
            <div v-if="restArticles.length" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              <article
                v-for="item in restArticles"
                :key="item.id"
                class="group bg-white rounded-2xl overflow-hidden border border-[#E2E8DF] shadow-[0_2px_8px_rgba(0,0,0,0.03)] hover:shadow-[0_10px_24px_rgba(74,103,65,0.12)] hover:border-[#7CB342] transition-all duration-300 flex flex-col hover:-translate-y-1 h-full"
              >
                <nuxt-link :to="typeLink(item.slug)" class="block relative w-full aspect-video overflow-hidden bg-[#EEF4EC] no-underline shrink-0">
                  <img
                    :src="item.thumbnailUrl || '/assets/hero_banner.jpg'"
                    :alt="item.title"
                    loading="lazy"
                    decoding="async"
                    class="w-full h-full aspect-video object-cover object-center transition-transform duration-500 ease-out group-hover:scale-105"
                  />
                </nuxt-link>
                <div class="p-4 sm:p-5 flex flex-col flex-1">
                  <div class="flex items-center gap-2 text-xs text-[#7A8A76] font-medium mb-2">
                    <span class="inline-block bg-[#EEF4EC] text-[#3A6033] font-bold text-[0.68rem] px-2 py-0.5 rounded uppercase tracking-wider">
                      {{ item.categoryName || typeName || typeSlug }}
                    </span>
                    <span class="flex items-center gap-1 text-[#889684] text-[0.75rem]">
                      <i class="fa-regular fa-calendar-days text-[0.72rem]" aria-hidden="true"></i>
                      <span>{{ formatDate(item) }}</span>
                    </span>
                  </div>
                  <h3 class="text-[0.95rem] sm:text-[0.98rem] font-bold leading-snug text-[#172516] group-hover:text-[#2D5A27] transition-colors duration-200 line-clamp-2 min-h-[2.6rem] mb-2 m-0">
                    <nuxt-link :to="typeLink(item.slug)" class="text-[#172516] hover:text-[#2D5A27] no-underline">
                      {{ item.title }}
                    </nuxt-link>
                  </h3>
                  <p v-if="item.excerpt" class="text-[0.84rem] text-[#556450] leading-relaxed line-clamp-2 mb-3 m-0">
                    {{ item.excerpt }}
                  </p>
                  <div class="mt-auto pt-3 border-t border-[#F0F5EE] flex items-center justify-between text-xs text-[#7A8A76]">
                    <nuxt-link
                      :to="typeLink(item.slug)"
                      class="inline-flex items-center gap-1.5 font-bold text-[#385932] hover:text-[#1B3617] group-hover:translate-x-0.5 transition-all no-underline"
                    >
                      <span>{{ t('view_details') }}</span>
                      <i class="fa-solid fa-arrow-right text-[0.68rem] transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true"></i>
                    </nuxt-link>
                    <span class="text-[#8E9F8B] font-medium text-[0.72rem]">{{ t('n_c11_badge') }}</span>
                  </div>
                </div>
              </article>
            </div>

            <!-- Pagination -->
            <nav v-if="pagination.totalPages > 1" class="flex items-center justify-center gap-2 pt-2" :aria-label="t('page_of').replace('{current}', String(page)).replace('{total}', String(pagination.totalPages))">
              <nuxt-link
                v-if="page > 1"
                :to="pagePath(page - 1)"
                class="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white border border-[#DCE5DB] text-[#4A5545] text-xs font-bold hover:bg-[#F2F7F0] no-underline"
              >
                <i class="fa-solid fa-arrow-left text-[0.65rem]" aria-hidden="true"></i>
                <span>{{ t('page_prev') }}</span>
              </nuxt-link>
              <span class="px-3 py-2 text-xs font-bold text-[#4A6741]">
                <span class="sr-only">{{ t('n_pagination_summary').replace('{current}', String(page)).replace('{total}', String(pagination.totalPages)) }} </span>
                {{ page }} / {{ pagination.totalPages }}
              </span>
              <nuxt-link
                v-if="page < pagination.totalPages"
                :to="pagePath(page + 1)"
                class="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white border border-[#DCE5DB] text-[#4A5545] text-xs font-bold hover:bg-[#F2F7F0] no-underline"
              >
                <span>{{ t('page_next') }}</span>
                <i class="fa-solid fa-arrow-right text-[0.65rem]" aria-hidden="true"></i>
              </nuxt-link>
            </nav>
          </template>
        </div>

        <!-- Right Rail / Sidebar -->
        <aside class="flex flex-col gap-6 min-w-0 lg:sticky lg:top-[90px]">
          <!-- Widget 1: Đọc nhiều -->
          <div class="bg-white rounded-lg border border-[#E2E8DF] shadow-sm px-5 py-2">
            <h2 class="text-[0.8rem] font-extrabold text-[#4A6741] uppercase tracking-[0.6px] pt-3 pb-2 border-b-2 border-[#E2E8DF] m-0">{{ t('n_most_read_short') }}</h2>
            <div v-if="mostReadPending" role="status" aria-busy="true" class="py-2">
              <span class="sr-only">{{ t('n_loading_most_read') }}</span>
              <div aria-hidden="true" class="flex flex-col">
                <div v-for="n in 6" :key="n" class="flex gap-3 py-3 border-b border-[#E2E8DF] last:border-b-0">
                  <div class="h-6 w-6 bg-[#EEF2EC] rounded shrink-0 animate-pulse motion-reduce:animate-none"></div>
                  <div class="flex-1 flex flex-col gap-1.5 pt-0.5">
                    <div class="h-3.5 w-full bg-[#EEF2EC] rounded animate-pulse motion-reduce:animate-none"></div>
                    <div class="h-3.5 w-2/3 bg-[#EEF2EC] rounded animate-pulse motion-reduce:animate-none"></div>
                  </div>
                </div>
              </div>
            </div>
            <ul v-else-if="mostRead.length" class="list-none p-0 m-0">
              <li
                v-for="(item, i) in mostRead"
                :key="item.id"
                class="flex gap-3 py-[13px] border-b border-[#E2E8DF] last:border-b-0"
              >
                <span class="w-7 shrink-0 text-right text-[1.45rem] leading-[1.15] font-extrabold" :class="i < 3 ? 'text-[#7CB342]' : 'text-[#C7D2C2]'">{{ i + 1 }}</span>
                <h3 class="text-[0.9rem] font-bold leading-[1.4] m-0 min-w-0">
                  <nuxt-link
                    :to="typeLink(item.slug)"
                    class="text-[#1E251C] no-underline transition-colors duration-300 hover:text-[#4A6741] line-clamp-2"
                  >{{ item.title }}</nuxt-link>
                </h3>
              </li>
            </ul>
            <p v-else class="text-[0.85rem] text-[#7A8675] italic py-4 m-0">{{ t('n_no_views') }}</p>
          </div>

          <!-- Widget 2: Chuyên mục -->
          <div v-if="rootCategories.length" class="bg-white rounded-2xl border border-[#DDE6DC] shadow-sm p-5">
            <div class="flex items-center gap-2 pb-3 border-b border-[#EEF3ED] mb-3">
              <span class="w-7 h-7 rounded-lg bg-[#EBF3E8] text-[#4A6741] flex items-center justify-center text-xs shadow-sm">
                <i class="fa-solid fa-folder-open" aria-hidden="true"></i>
              </span>
              <h2 class="text-[0.92rem] font-black text-[#172516] uppercase tracking-wide m-0">
                {{ t('n_category_widget') }}
              </h2>
            </div>
            <div class="flex flex-col divide-y divide-[#F2F6F0]">
              <button
                type="button"
                class="flex items-center justify-between py-2.5 text-xs font-extrabold text-left transition-colors"
                :class="activeCategory === 'all' ? 'text-[#385932]' : 'text-[#4A5746] hover:text-[#385932]'"
                @click="setCategory('all')"
              >
                <span class="flex items-center gap-2">
                  <i class="fa-solid fa-layer-group text-[0.7rem] text-[#8CA088]" aria-hidden="true"></i>
                  <span>{{ t('n_all_news') }}</span>
                </span>
                <i class="fa-solid fa-chevron-right text-[0.65rem] text-[#A0B09C]" aria-hidden="true"></i>
              </button>
              <button
                v-for="cat in rootCategories"
                :key="cat.id"
                type="button"
                class="flex items-center justify-between py-2.5 text-xs font-extrabold text-left transition-colors"
                :class="activeCategory === cat.slug ? 'text-[#385932]' : 'text-[#4A5746] hover:text-[#385932]'"
                @click="setCategory(cat.slug)"
              >
                <span class="flex items-center gap-2">
                  <i :class="categoryIcon(cat.slug)" class="text-[0.7rem] text-[#8CA088]" aria-hidden="true"></i>
                  <span>{{ cat.name }}</span>
                </span>
                <i class="fa-solid fa-chevron-right text-[0.65rem] text-[#A0B09C]" aria-hidden="true"></i>
              </button>
            </div>
          </div>

          <!-- Widget 3: Hotline & Hỗ Trợ 24/7 -->
          <div class="relative rounded-2xl overflow-hidden shadow-md text-white bg-gradient-to-br from-[#294B26] via-[#203D1E] to-[#162D15] p-6 border border-[#3E6539]">
            <div class="flex items-center gap-2 mb-2">
              <span class="w-6 h-6 rounded-full bg-white/15 flex items-center justify-center text-xs">
                <i class="fa-solid fa-shield-halved text-[#A8D59D]" aria-hidden="true"></i>
              </span>
              <span class="text-[0.7rem] font-black uppercase tracking-wider text-[#A8D59D]">{{ t('support_24_7') }}</span>
            </div>
            <h3 class="text-[1.05rem] font-black m-0 mb-1.5 leading-snug">{{ t('hotline_title') }}</h3>
            <p class="text-xs leading-relaxed m-0 mb-4 text-white/80">{{ t('hotline_desc') }}</p>
            <a
              href="tel:0903480985"
              class="flex items-center justify-center gap-2.5 w-full bg-[#7CB342] hover:bg-[#689F38] text-white py-2.5 px-4 rounded-xl text-sm font-black no-underline transition-all shadow-md mb-2.5"
            >
              <i class="fa-solid fa-phone" aria-hidden="true"></i>
              <span>0903.480.985</span>
            </a>
            <nuxt-link
              to="/assistant"
              class="flex items-center justify-center gap-2 w-full bg-white/10 hover:bg-white/20 text-white text-xs font-bold py-2 px-3 rounded-xl no-underline transition-all border border-white/15"
            >
              <i class="fa-solid fa-robot text-[0.8rem]" aria-hidden="true"></i>
              <span>{{ t('ask_ai_24_7') }}</span>
            </nuxt-link>
          </div>

          <!-- Widget 4: Tra cứu nhanh -->
          <div class="bg-white rounded-2xl border border-[#DDE6DC] shadow-sm p-5">
            <div class="flex items-center gap-2 pb-3 border-b border-[#EEF3ED] mb-3">
              <span class="w-7 h-7 rounded-lg bg-[#EBF3E8] text-[#4A6741] flex items-center justify-center text-xs shadow-sm">
                <i class="fa-solid fa-bookmark" aria-hidden="true"></i>
              </span>
              <h2 class="text-[0.92rem] font-black text-[#172516] uppercase tracking-wide m-0">
                {{ t('quick_tools') }}
              </h2>
            </div>
            <div class="flex flex-col gap-2 text-xs">
              <nuxt-link to="/documents" class="flex items-center justify-between p-2.5 rounded-xl bg-[#F7FAF6] hover:bg-[#EEF4EC] text-[#2C3E29] font-bold no-underline transition-all border border-[#E4EDE2]">
                <span class="flex items-center gap-2">
                  <i class="fa-solid fa-file-contract text-[#4A6741]" aria-hidden="true"></i>
                  <span>Văn bản pháp luật</span>
                </span>
                <i class="fa-solid fa-chevron-right text-[0.65rem] text-[#A0B09C]" aria-hidden="true"></i>
              </nuxt-link>
              <nuxt-link to="/legal-qa" class="flex items-center justify-between p-2.5 rounded-xl bg-[#F7FAF6] hover:bg-[#EEF4EC] text-[#2C3E29] font-bold no-underline transition-all border border-[#E4EDE2]">
                <span class="flex items-center gap-2">
                  <i class="fa-solid fa-circle-question text-[#4A6741]" aria-hidden="true"></i>
                  <span>Giải đáp pháp luật</span>
                </span>
                <i class="fa-solid fa-chevron-right text-[0.65rem] text-[#A0B09C]" aria-hidden="true"></i>
              </nuxt-link>
              <nuxt-link to="/reintegration-models" class="flex items-center justify-between p-2.5 rounded-xl bg-[#F7FAF6] hover:bg-[#EEF4EC] text-[#2C3E29] font-bold no-underline transition-all border border-[#E4EDE2]">
                <span class="flex items-center gap-2">
                  <i class="fa-solid fa-people-group text-[#4A6741]" aria-hidden="true"></i>
                  <span>Mô hình tái hòa nhập</span>
                </span>
                <i class="fa-solid fa-chevron-right text-[0.65rem] text-[#A0B09C]" aria-hidden="true"></i>
              </nuxt-link>
            </div>
          </div>
        </aside>
      </div>
    </section>
  </div>
</template>
