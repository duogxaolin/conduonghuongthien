<template>
  <!-- Section Title Divider -->
  <div v-if="items.length" class="flex items-center justify-between pt-3 pb-3 border-b-2 border-line mt-1 mb-5">
    <div class="flex items-center gap-2.5">
      <span class="w-2.5 h-6 rounded-sm bg-brand-600" aria-hidden="true"></span>
      <h2 class="text-base sm:text-lg font-black text-[#1A2A17] tracking-tight uppercase m-0">
        {{ t('n_list_title') }}
      </h2>
      <span class="text-xs font-extrabold px-2.5 py-0.5 rounded-full bg-line text-brand-800">
        {{ t('n_count_suffix').replace('{n}', String(total)) }}
      </span>
    </div>
    <span v-if="totalPages > 1" class="text-xs text-ink-soft font-medium hidden sm:inline">
      {{ t('page_of').replace('{current}', String(page)).replace('{total}', String(totalPages)) }}
    </span>
  </div>

  <!-- Responsive 3-Column Magazine Grid -->
  <div v-if="items.length" :class="gridClass">
    <article
      v-for="item in items"
      :key="item.id"
      class="group bg-white rounded-2xl overflow-hidden border border-line shadow-[0_2px_8px_rgba(0,0,0,0.03)] hover:shadow-[0_10px_24px_rgba(74,103,65,0.12)] hover:border-accent transition-all duration-300 flex flex-col hover:-translate-y-1 h-full"
    >
      <!-- Thumbnail: strictly 16:9 -->
      <nuxt-link :to="`/news/${item.slug}`" class="block relative w-full aspect-video overflow-hidden bg-surface-tint no-underline shrink-0">
        <SafeImg
          :src="item.thumbnailUrl || '/assets/hero_banner.jpg'"
          :alt="item.title" img-class="w-full h-full aspect-video object-cover object-center transition-transform duration-500 ease-out group-hover:scale-105"
          loading="lazy"
          decoding="async"
          sizes="256px sm:384px lg:512px"
        />
        <div class="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
      </nuxt-link>

      <!-- Card Content: flex-1 flex-col justify-between -->
      <div class="p-4 sm:p-5 flex flex-col flex-1">
        <div class="flex items-center gap-2 text-xs text-ink-soft font-medium mb-2">
          <span
            v-if="item.categoryName"
            class="inline-block bg-surface-tint text-[#3A6033] font-bold text-[0.68rem] px-2 py-0.5 rounded uppercase tracking-wider"
          >
            {{ item.categoryName }}
          </span>
          <span class="flex items-center gap-1 text-ink-soft text-[0.75rem]">
            <i class="fa-regular fa-calendar-days text-[0.72rem]" aria-hidden="true"></i>
            <span>{{ listItemDate(item) }}</span>
          </span>
        </div>

        <h3 class="text-[0.95rem] sm:text-[0.98rem] font-bold leading-snug text-ink-strong group-hover:text-[#2D5A27] transition-colors duration-200 line-clamp-2 min-h-[2.6rem] mb-2 m-0">
          <nuxt-link :to="`/news/${item.slug}`" class="text-ink-strong hover:text-[#2D5A27] no-underline">
            {{ item.title }}
          </nuxt-link>
        </h3>

        <p v-if="item.excerpt" class="text-[0.84rem] text-ink-soft leading-relaxed line-clamp-2 mb-3 m-0">
          {{ cleanExcerpt(item.excerpt) }}
        </p>

        <!-- Footer action pinned to bottom of card with mt-auto -->
        <div class="mt-auto pt-3 border-t border-surface-tint flex items-center justify-between text-xs text-ink-soft">
          <nuxt-link
            :to="`/news/${item.slug}`"
            class="inline-flex items-center gap-1.5 font-bold text-brand-800 hover:text-[#1B3617] group-hover:translate-x-0.5 transition-all no-underline"
          >
            <span>{{ t('n_view_details') }}</span>
            <i class="fa-solid fa-arrow-right text-[0.68rem] transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true"></i>
          </nuxt-link>
          <span class="text-[#6B7B68] font-medium text-[0.72rem]">{{ t('n_c11_badge') }}</span>
        </div>
      </div>
    </article>
  </div>
</template>

<script setup lang="ts">
/**
 * `/news` list below the lead story: the "Danh sách bản tin" header (count + page) and the
 * card grid. Both render only when there are cards — the page shows this part
 * unconditionally so the two `v-if` placeholders stay where they were. Display only.
 */
import { cleanExcerpt } from '~/utils/article-excerpt'
import { listItemDate } from '~/utils/news/list-display'
import { useI18n } from '~/composables/useI18n'
import type { PublicArticleListItem } from '~/utils/public-types'

defineProps<{
  items: PublicArticleListItem[]
  /** Articles in the whole list (all pages). */
  total: number
  page: number
  totalPages: number
  /** The configured grid (`useLayoutConfig().articleGridClass`). */
  gridClass: string
}>()

const { t } = useI18n()
</script>
