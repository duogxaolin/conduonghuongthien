<script setup lang="ts">
import type { PublicArticleListItem, PublicPagination } from '~/utils/public-types'
import { useI18n } from '~/composables/useI18n'
import { computed } from 'vue'

/**
 * Trang list bài cho một Content-Type custom (type tạo qua /admin/content/content-types,
 * không có route tĩnh riêng như /news hay /role-models).
 *
 * KHÔNG dùng `NewsCategoryList` vì component đó hardcode chip danh mục + breadcrumb
 * `/news` — không khớp type custom. Component này tự render grid + skeleton + empty
 * theo contract load/error/empty của trang công khai.
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
})

const { t, currentLang } = useI18n()

interface ListResponse {
  ok: boolean
  articles: PublicArticleListItem[]
  pagination: PublicPagination
}

const page = computed(() => {
  const n = Number(useRoute().query.page)
  return Number.isSafeInteger(n) && n > 0 ? n : 1
})

const { data, pending, error, refresh } = await useAsyncData(
  () => `content-type-list-${props.typeSlug}-${page.value}-${currentLang.value}`,
  () => ($fetch as (u: string, o?: Record<string, unknown>) => Promise<ListResponse>)('/api/public/articles', {
    query: { type: props.typeSlug, page: page.value, limit: 24, lang: currentLang.value },
  }),
  {
    lazy: true,
    default: () => ({ ok: true, articles: [], pagination: { page: 1, limit: 24, total: 0, totalPages: 0 } }),
    watch: [() => props.typeSlug, page, currentLang],
  },
)

const articles = computed(() => (data.value as ListResponse | null)?.articles || [])
const loadError = computed(() => !!error.value || (data.value as { ok?: boolean } | null)?.ok === false)
const totalPages = computed(() => (data.value as ListResponse | null)?.pagination?.totalPages || 0)
</script>

<template>
  <div class="bg-[#F8FAF7]">
    <!-- Page Header -->
    <section class="border-b border-[#E2E8DF] bg-white">
      <div class="container pt-7 sm:pt-9 pb-5">
        <nav :aria-label="t('breadcrumb_aria')" class="flex items-center gap-2 text-xs text-[#7A8A76] mb-3">
          <nuxt-link to="/" class="hover:text-[#4A6741] transition-colors flex items-center gap-1.5 no-underline text-[#556450]">
            <i class="fa-solid fa-house text-[0.7rem]" aria-hidden="true"></i>
            <span>{{ t('home') }}</span>
          </nuxt-link>
          <span class="text-[#BAC8B6]">&rsaquo;</span>
          <span class="text-[#2D5A27] font-bold">{{ typeName || typeSlug }}</span>
        </nav>

        <p class="text-[0.78rem] font-extrabold uppercase tracking-[1.2px] text-[#7CB342] m-0 mb-1">
          <i v-if="typeIcon" :class="typeIcon" class="mr-1.5" aria-hidden="true"></i>
          {{ t('news_category_title') }}
        </p>
        <h1 class="text-[1.65rem] sm:text-[2.05rem] font-extrabold text-[#1E251C] leading-[1.2] m-0">
          {{ typeName || typeSlug }}
        </h1>
        <p v-if="typeDescription" class="text-[0.95rem] text-[#5A6655] mt-2 mb-5 leading-relaxed">
          {{ typeDescription }}
        </p>
      </div>
    </section>

    <!-- Main Content -->
    <section class="py-8 lg:py-10">
      <div class="container flex flex-col gap-7 min-w-0">
        <!-- Section Divider Header -->
        <div class="flex items-center justify-between pt-1 pb-3 border-b-2 border-[#E1EADF] mb-1">
          <div class="flex items-center gap-2.5">
            <span class="w-2.5 h-6 rounded-sm bg-[#4A6741]" aria-hidden="true"></span>
            <h2 class="text-base sm:text-lg font-black text-[#1A2A17] tracking-tight uppercase m-0">
              {{ typeName || typeSlug }}
            </h2>
            <span v-if="!pending" class="text-xs font-extrabold px-2.5 py-0.5 rounded-full bg-[#EBF3E8] text-[#385932]">
              {{ t('n_count_suffix').replace('{n}', String(articles.length)) }}
            </span>
          </div>
        </div>

        <!-- Loading (Skeleton) -->
        <div v-if="pending" role="status" aria-busy="true" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          <span class="sr-only">{{ t('n_list_loading') }}</span>
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

        <!-- Grid -->
        <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          <article
            v-for="item in articles"
            :key="item.id"
            class="group bg-white rounded-2xl overflow-hidden border border-[#E2E8DF] shadow-[0_2px_8px_rgba(0,0,0,0.03)] hover:shadow-[0_10px_24px_rgba(74,103,65,0.12)] hover:border-[#7CB342] transition-all duration-300 flex flex-col hover:-translate-y-1 h-full"
          >
            <nuxt-link :to="`/${typeSlug}/${item.slug}`" class="block relative w-full aspect-video overflow-hidden bg-[#EEF4EC] no-underline shrink-0">
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
                  <span>{{ formatDateVN(item.publishedAt || item.createdAt) }}</span>
                </span>
              </div>
              <h3 class="text-[0.95rem] sm:text-[0.98rem] font-bold leading-snug text-[#172516] group-hover:text-[#2D5A27] transition-colors duration-200 line-clamp-2 min-h-[2.6rem] mb-2 m-0">
                <nuxt-link :to="`/${typeSlug}/${item.slug}`" class="text-[#172516] hover:text-[#2D5A27] no-underline">
                  {{ item.title }}
                </nuxt-link>
              </h3>
              <p v-if="item.excerpt" class="text-[0.84rem] text-[#556450] leading-relaxed line-clamp-2 mb-3 m-0">
                {{ item.excerpt }}
              </p>
              <div class="mt-auto pt-3 border-t border-[#F0F5EE] flex items-center justify-between text-xs text-[#7A8A76]">
                <nuxt-link
                  :to="`/${typeSlug}/${item.slug}`"
                  class="inline-flex items-center gap-1.5 font-bold text-[#385932] hover:text-[#1B3617] group-hover:translate-x-0.5 transition-all no-underline"
                >
                  <span>{{ t('view_details') }}</span>
                  <i class="fa-solid fa-arrow-right text-[0.68rem] transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true"></i>
                </nuxt-link>
                <span class="text-[#8E9F8B] font-medium text-[0.72rem]">{{ t('c11_news_badge') }}</span>
              </div>
            </div>
          </article>
        </div>

        <!-- Pagination -->
        <nav v-if="totalPages > 1" class="flex items-center justify-center gap-2 pt-2" :aria-label="t('pagination_aria')">
          <nuxt-link
            v-if="page > 1"
            :to="`/${typeSlug}?page=${page - 1}`"
            class="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white border border-[#DCE5DB] text-[#4A5545] text-xs font-bold hover:bg-[#F2F7F0] no-underline"
          >
            <i class="fa-solid fa-arrow-left text-[0.65rem]" aria-hidden="true"></i>
            <span>{{ t('prev_page') }}</span>
          </nuxt-link>
          <span class="px-3 py-2 text-xs font-bold text-[#4A6741]">
            {{ page }} / {{ totalPages }}
          </span>
          <nuxt-link
            v-if="page < totalPages"
            :to="`/${typeSlug}?page=${page + 1}`"
            class="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white border border-[#DCE5DB] text-[#4A5545] text-xs font-bold hover:bg-[#F2F7F0] no-underline"
          >
            <span>{{ t('next_page') }}</span>
            <i class="fa-solid fa-arrow-right text-[0.65rem]" aria-hidden="true"></i>
          </nuxt-link>
        </nav>
      </div>
    </section>
  </div>
</template>
