<template>
  <div class="min-h-screen bg-surface">
    <!-- Breadcrumb & Header Bar -->
    <section class="bg-white border-b border-line">
      <div class="container py-7 sm:py-9">
        <nav :aria-label="t('sp_breadcrumb_aria')" class="flex items-center gap-2 text-xs text-ink-soft mb-3">
          <nuxt-link to="/" class="hover:text-brand-600 transition-colors flex items-center gap-1.5 no-underline text-ink-soft">
            <i class="fa-solid fa-house text-[0.7rem]" aria-hidden="true"></i>
            <span>{{ t('home') }}</span>
          </nuxt-link>
          <span class="text-[#BAC8B6]">&rsaquo;</span>
          <span class="text-[#2D5A27] font-bold">{{ t('search') }}</span>
        </nav>

        <h1 class="text-2xl sm:text-3xl font-black text-ink-strong tracking-tight m-0 mb-2">{{ t('sp_title') }}</h1>
        <p class="text-sm text-ink-soft max-w-2xl m-0 leading-relaxed">{{ t('sp_intro') }}</p>

        <!-- Big Search Form -->
        <form @submit.prevent="onFormSubmit" class="mt-6 max-w-3xl">
          <div class="relative flex items-center bg-white rounded-xl border-2 border-[#D5E1D3] focus-within:border-brand-600 focus-within:shadow-[0_4px_16px_rgba(74,103,65,0.12)] transition-all overflow-hidden p-1.5 shadow-sm">
            <span class="w-10 flex items-center justify-center text-ink-soft text-sm shrink-0">
              <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
            </span>
            <input
              ref="searchInputEl"
              v-model="inputQuery"
              type="text"
              :aria-label="t('sp_input_aria')"
              :placeholder="t('sp_input_ph')"
              class="w-full py-2.5 px-2 text-[0.95rem] text-ink-strong outline-none border-none bg-transparent font-medium placeholder:text-[#9AABA0]"
            />
            <button
              v-if="inputQuery"
              type="button"
              @click="inputQuery = ''; inputFocus()"
              class="w-8 h-8 rounded-lg text-ink-faint hover:text-[#2D5A27] hover:bg-surface-tint flex items-center justify-center text-xs shrink-0 cursor-pointer border-none bg-transparent transition-colors mr-1"
              :aria-label="t('sp_clear_aria')"
            >
              <i class="fa-solid fa-xmark" aria-hidden="true"></i>
            </button>
            <button
              type="submit"
              class="bg-brand-600 hover:bg-brand-800 text-white px-5 sm:px-6 py-2.5 rounded-lg text-sm font-extrabold cursor-pointer transition-all shrink-0 border-none flex items-center gap-2 shadow-sm"
            >
              <span>{{ t('search') }}</span>
              <i class="fa-solid fa-arrow-right text-xs" aria-hidden="true"></i>
            </button>
          </div>
        </form>
      </div>
    </section>

    <!-- Main Results Section -->
    <section class="container py-8 sm:py-10">
      <!-- Query Summary & Type Filter Tabs -->
      <div v-if="searchQuery" class="mb-6">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-line">
          <div>
            <h2 class="text-lg font-black text-ink-strong m-0">
              {{ t('sp_results_for') }} <span class="text-[#2D5A27]">&laquo;{{ searchQuery }}&raquo;</span>
            </h2>
            <p class="text-xs text-ink-soft mt-1 m-0"><I18nStrong :text="t(countKey('sp_found', searchData?.total ?? 0))" :values="{ n: searchData?.total ?? 0 }" /></p>
          </div>

          <div v-if="pending" class="text-xs text-brand-600 font-semibold flex items-center gap-2">
            <i class="fa-solid fa-circle-notch animate-spin text-sm" aria-hidden="true"></i>
            <span>{{ t('sp_searching') }}</span>
          </div>
        </div>

        <!-- Filter Tabs -->
        <div class="flex items-center gap-2 overflow-x-auto py-3 no-scrollbar">
          <button
            v-for="tab in filterTabs"
            :key="tab.key"
            type="button"
            @click="setTab(tab.key)"
            :class="[
              'px-3.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all border shrink-0 flex items-center gap-2',
              activeType === tab.key
                ? 'bg-brand-600 text-white border-brand-600 shadow-sm'
                : 'bg-white text-ink-secondary border-line hover:border-brand-600 hover:bg-surface-tint'
            ]"
          >
            <i :class="tab.icon" class="text-[0.75rem]" aria-hidden="true"></i>
            <span>{{ t(tab.labelKey) }}</span>
            <span
              :class="[
                'text-[0.7rem] px-1.5 py-px rounded-full font-black',
                activeType === tab.key ? 'bg-white/20 text-white' : 'bg-surface-tint text-ink-soft'
              ]"
            >
              {{ getCountForTab(tab.key) }}
            </span>
          </button>
        </div>
      </div>

      <!-- Loading State -->
      <div v-if="pending" role="status" aria-busy="true" class="space-y-4">
        <span class="sr-only">{{ t('sp_loading_sr') }}</span>
        <div v-for="n in 5" :key="n" class="bg-white p-5 rounded-xl border border-line flex gap-4 animate-pulse motion-reduce:animate-none">
          <div class="w-24 sm:w-32 aspect-video bg-surface-tint rounded-lg shrink-0"></div>
          <div class="flex-1 space-y-2.5">
            <div class="h-4 w-28 bg-surface-tint rounded"></div>
            <div class="h-5 w-3/4 bg-surface-tint rounded"></div>
            <div class="h-3.5 w-full bg-surface-tint rounded"></div>
          </div>
        </div>
      </div>

      <!-- Error State -->
      <div
        v-else-if="error"
        role="alert"
        class="bg-white border-2 border-dashed border-[#F0B8B8] px-6 py-12 rounded-2xl text-center text-danger-soft shadow-sm"
      >
        <div class="w-12 h-12 rounded-full bg-danger-bg text-[#C62828] flex items-center justify-center mx-auto mb-3 text-lg">
          <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
        </div>
        <h3 class="text-base font-extrabold text-[#992222] m-0 mb-1">{{ t('sp_error_title') }}</h3>
        <p class="text-sm text-ink-muted m-0 mb-4">{{ t('sp_error_desc') }}</p>
        <button
          type="button"
          class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#C62828] text-white text-xs font-bold hover:bg-[#B71C1C] transition-all cursor-pointer border-none"
          @click="() => refresh()"
        >
          <i class="fa-solid fa-rotate-right" aria-hidden="true"></i>
          <span>{{ t('sp_retry') }}</span>
        </button>
      </div>

      <!-- No Query Initial State -->
      <div v-else-if="!searchQuery" class="bg-white border border-line rounded-2xl p-10 text-center max-w-xl mx-auto shadow-sm">
        <div class="w-16 h-16 rounded-full bg-line text-brand-600 flex items-center justify-center mx-auto mb-4 text-2xl shadow-sm">
          <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
        </div>
        <h3 class="text-lg font-extrabold text-ink-strong m-0 mb-2">{{ t('sp_idle_title') }}</h3>
        <p class="text-sm text-ink-soft m-0 leading-relaxed mb-6">{{ t('sp_idle_desc') }}</p>
        <div class="flex flex-wrap items-center justify-center gap-2 text-xs">
          <span class="text-ink-soft font-medium">{{ t('sp_suggest') }}</span>
          <!-- Từ khoá tìm trên nội dung tiếng Việt của cổng: cố ý không dịch (dịch thì 0 kết quả). -->
          <button
            v-for="kw in ['Ninh Bình', 'Tái hòa nhập', 'Tấm gương', 'Văn bản', 'Nghị định']"
            :key="kw"
            type="button"
            @click="quickSearch(kw)"
            class="px-2.5 py-1 rounded-md bg-surface-tint text-brand-800 hover:bg-brand-600 hover:text-white transition-all font-bold cursor-pointer border border-[#D5E1D3]"
          >
            {{ kw }}
          </button>
        </div>
      </div>

      <!-- Empty Results State -->
      <div v-else-if="!searchData?.items?.length" class="bg-white border border-line rounded-2xl p-10 text-center max-w-xl mx-auto shadow-sm">
        <div class="w-16 h-16 rounded-full bg-danger-bg text-[#C62828] flex items-center justify-center mx-auto mb-4 text-2xl">
          <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
        </div>
        <h3 class="text-lg font-extrabold text-ink-strong m-0 mb-2">{{ t('sp_empty_title') }}</h3>
        <p class="text-sm text-ink-soft m-0 leading-relaxed mb-6"><I18nStrong :text="t('sp_empty_desc')" :values="{ q: searchQuery }" /></p>
        <div class="flex justify-center gap-3">
          <button
            v-if="activeType !== 'all'"
            type="button"
            @click="setTab('all')"
            class="px-4 py-2 rounded-lg bg-brand-600 text-white text-xs font-bold hover:bg-brand-800 transition-all cursor-pointer border-none"
          >
            {{ t('sp_all_categories') }}
          </button>
          <button
            type="button"
            @click="inputQuery = ''; inputFocus()"
            class="px-4 py-2 rounded-lg border border-[#D5E1D3] bg-white text-ink-secondary text-xs font-bold hover:bg-surface-tint transition-all cursor-pointer"
          >
            {{ t('sp_new_keyword') }}
          </button>
        </div>
      </div>

      <!-- Results List -->
      <div v-else class="space-y-4">
        <article
          v-for="item in searchData.items"
          :key="item.id"
          class="group bg-white rounded-xl border border-line shadow-[0_2px_8px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_20px_rgba(74,103,65,0.1)] hover:border-accent transition-all p-4 sm:p-5 flex flex-col sm:flex-row gap-4 sm:gap-5"
        >
          <!-- Thumbnail (if any) -->
          <nuxt-link
            v-if="item.thumbnailUrl"
            :to="item.url"
            class="block w-full sm:w-40 md:w-48 aspect-video bg-surface-tint rounded-lg overflow-hidden shrink-0 no-underline"
          >
            <img
              :src="item.thumbnailUrl"
              :alt="item.title"
              class="w-full h-full object-cover object-center transition-transform duration-500 ease-out group-hover:scale-105"
              loading="lazy"
              decoding="async"
            />
          </nuxt-link>

          <!-- Content Details -->
          <div class="flex flex-col justify-between flex-1 min-w-0">
            <div>
              <div class="flex items-center gap-2 mb-2 flex-wrap">
                <!-- Type Badge -->
                <span :class="['inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[0.7rem] font-extrabold uppercase tracking-wider', item.typeBadgeClass]">
                  <i :class="item.typeIcon" class="text-[0.65rem]" aria-hidden="true"></i>
                  <span>{{ searchTypeLabel(item) }}</span>
                </span>

                <!-- Category Name -->
                <span v-if="item.categoryName" class="text-xs text-ink-soft font-semibold">
                  {{ item.categoryName }}
                </span>

                <!-- Published Date -->
                <span v-if="item.publishedAt" class="text-xs text-ink-soft flex items-center gap-1 font-medium">
                  <i class="fa-regular fa-calendar-days text-[0.7rem]" aria-hidden="true"></i>
                  <span>{{ formatDate(item.publishedAt) }}</span>
                </span>
              </div>

              <!-- Title -->
              <h3 class="text-base sm:text-[1.1rem] font-bold text-ink-strong group-hover:text-[#2D5A27] transition-colors leading-snug m-0 mb-2">
                <nuxt-link :to="item.url" class="text-ink-strong hover:text-[#2D5A27] no-underline">
                  {{ item.title }}
                </nuxt-link>
              </h3>

              <!-- Excerpt -->
              <p v-if="item.excerpt" class="text-[0.88rem] text-ink-soft leading-relaxed line-clamp-2 m-0 mb-3">
                {{ item.excerpt }}
              </p>
            </div>

            <!-- Bottom link -->
            <div class="pt-2.5 border-t border-surface flex items-center justify-between text-xs">
              <nuxt-link
                :to="item.url"
                class="inline-flex items-center gap-1.5 font-extrabold text-brand-800 hover:text-[#1B3617] transition-all no-underline group/link"
              >
                <span>{{ t('view_detail') }}</span>
                <i class="fa-solid fa-arrow-right text-[0.68rem] transition-transform duration-200 group-hover/link:translate-x-1" aria-hidden="true"></i>
              </nuxt-link>
              <span class="text-[#6B7B68] font-medium text-[0.75rem]">{{ t('sp_source') }}</span>
            </div>
          </div>
        </article>

        <!-- Pagination -->
        <nav
          v-if="searchData.pagination && searchData.pagination.totalPages > 1"
          :aria-label="t('sp_pagination_aria')"
          class="flex flex-col sm:flex-row items-center justify-between gap-4 mt-8 pt-6 border-t border-line"
        >
          <div class="text-xs text-ink-soft font-medium">
            <I18nStrong :text="t('sp_page_of')" :values="{ page: currentPage, total: searchData.pagination.totalPages }" />
          </div>

          <div class="flex items-center gap-1.5 flex-wrap justify-center">
            <button
              type="button"
              class="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-[#D5E1D3] bg-white text-ink-secondary text-xs font-bold cursor-pointer transition-all hover:border-brand-600 hover:text-brand-600 disabled:opacity-30 disabled:cursor-not-allowed"
              :disabled="currentPage <= 1"
              @click="setPage(currentPage - 1)"
              :aria-label="t('sp_prev_aria')"
            >
              <i class="fa-solid fa-chevron-left text-[0.7rem]" aria-hidden="true"></i>
            </button>

            <button
              v-for="p in searchData.pagination.totalPages"
              :key="p"
              type="button"
              :class="[
                'inline-flex items-center justify-center min-w-9 h-9 px-2.5 rounded-lg text-xs font-extrabold cursor-pointer transition-all',
                currentPage === p
                  ? 'bg-brand-600 text-white border border-[#4A6741] shadow-sm'
                  : 'bg-white border border-[#D5E1D3] text-ink-secondary hover:border-brand-600 hover:text-brand-600'
              ]"
              @click="setPage(p)"
            >
              {{ p }}
            </button>

            <button
              type="button"
              class="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-[#D5E1D3] bg-white text-ink-secondary text-xs font-bold cursor-pointer transition-all hover:border-brand-600 hover:text-brand-600 disabled:opacity-30 disabled:cursor-not-allowed"
              :disabled="currentPage >= searchData.pagination.totalPages"
              @click="setPage(currentPage + 1)"
              :aria-label="t('sp_next_aria')"
            >
              <i class="fa-solid fa-chevron-right text-[0.7rem]" aria-hidden="true"></i>
            </button>
          </div>
        </nav>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { formatDateVN } from '../utils/formatDate'
import { useI18n } from '~/composables/useI18n'
import I18nStrong from '~/components/I18nStrong.vue'
import { countKey } from '~/utils/i18n-placeholders'

// Mọi chữ giao diện qua `t()` (trang không cache: máy chủ render đúng ngôn ngữ của cookie
// từ từ điển hardcoded, trình duyệt đổi sang bản DB). Bản tiếng Anh từng hiện toàn tiếng Việt.
const { t } = useI18n()
useHead(() => ({ title: t('sp_seo_title'), meta: [{ name: 'description', content: t('sp_seo_desc') }] }))

const route = useRoute()
const router = useRouter()

const searchQuery = computed(() => String(route.query.q || '').trim())
const activeType = computed(() => String(route.query.type || 'all').trim().toLowerCase())
const currentPage = computed(() => {
  const p = Number(route.query.page || 1)
  return Number.isFinite(p) && p > 0 ? p : 1
})

const inputQuery = ref(searchQuery.value)

watch(searchQuery, (newVal) => {
  inputQuery.value = newVal
})

const filterTabs = [
  { key: 'all', labelKey: 'sp_tab_all', icon: 'fa-solid fa-layer-group' },
  { key: 'news', labelKey: 'sp_tab_news', icon: 'fa-solid fa-newspaper' },
  { key: 'role_model', labelKey: 'sp_tab_role_model', icon: 'fa-solid fa-award' },
  { key: 'reintegration_model', labelKey: 'sp_tab_reintegration_model', icon: 'fa-solid fa-people-group' },
  { key: 'document', labelKey: 'sp_tab_document', icon: 'fa-solid fa-file-lines' },
  { key: 'faq', labelKey: 'sp_tab_faq', icon: 'fa-solid fa-circle-question' },
  { key: 'qa', labelKey: 'sp_tab_qa', icon: 'fa-solid fa-comments' },
  { key: 'page', labelKey: 'sp_tab_page', icon: 'fa-solid fa-file-invoice' },
]
// Nhãn loại của từng kết quả: máy chủ gửi `typeLabel` tiếng Việt; dịch theo `type` đã biết,
// loại lạ (nội dung tự tạo) giữ nhãn của máy chủ.
const TYPE_LABEL_KEYS: Record<string, string> = {
  news: 'sp_type_news', role_model: 'sp_type_role_model', reintegration: 'sp_type_reintegration_model',
  reintegration_model: 'sp_type_reintegration_model', document: 'sp_type_document', faq: 'sp_type_faq', qa: 'sp_type_qa', page: 'sp_type_page',
}
const searchTypeLabel = (item: { type: string, typeLabel: string }) => (TYPE_LABEL_KEYS[item.type] ? t(TYPE_LABEL_KEYS[item.type]!) : item.typeLabel)

const { data: searchData, pending, error, refresh } = await useAsyncData(
  () => `search-${searchQuery.value}-${activeType.value}-${currentPage.value}`,
  () => publicFetch<import('~/types/public-content-api').PublicSearchResponse>('/api/public/search', {
    query: {
      q: searchQuery.value,
      type: activeType.value,
      page: currentPage.value,
      limit: 10,
    },
  }),
  {
    watch: [searchQuery, activeType, currentPage],
  },
)

const getCountForTab = (tabKey: string) => {
  if (!searchData.value?.counts) return 0
  const counts = searchData.value.counts as Record<string, number>
  return counts[tabKey] ?? 0
}

const onFormSubmit = () => {
  const q = inputQuery.value.trim()
  router.push({
    path: '/search',
    query: {
      q: q || undefined,
      type: activeType.value !== 'all' ? activeType.value : undefined,
      page: 1,
    },
  })
}

const setTab = (type: string) => {
  router.push({
    path: '/search',
    query: {
      ...route.query,
      type: type !== 'all' ? type : undefined,
      page: 1,
    },
  })
}

const setPage = (page: number) => {
  router.push({
    path: '/search',
    query: {
      ...route.query,
      page,
    },
  })
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

const quickSearch = (keyword: string) => {
  inputQuery.value = keyword
  onFormSubmit()
}

// Focus ô tìm kiếm CỦA TRANG này qua ref. `document.querySelector('input[type="text"]')`
// trước đây trúng ô đầu tiên trong tài liệu — ô tìm kiếm của ngăn kéo mobile (ẩn) trong layout.
const searchInputEl = ref<HTMLInputElement | null>(null)
const inputFocus = () => {
  searchInputEl.value?.focus()
}

const formatDate = (dateStr: string | null) => {
  return dateStr ? formatDateVN(dateStr) : ''
}
</script>
