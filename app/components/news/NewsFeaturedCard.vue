<template>
  <article
    class="group bg-white rounded-2xl overflow-hidden border border-line shadow-[0_4px_16px_rgba(0,0,0,0.04)] hover:shadow-[0_12px_30px_rgba(74,103,65,0.12)] hover:border-accent transition-all duration-300 flex flex-col lg:flex-row lg:items-stretch mb-6"
  >
    <nuxt-link
      :to="`/news/${item.slug}`"
      class="block overflow-hidden lg:w-[42%] xl:w-[40%] shrink-0 relative bg-surface-tint no-underline"
    >
      <SafeImg
        :src="item.thumbnailUrl || '/assets/hero_banner.jpg'"
        :alt="item.title" img-class="w-full h-[220px] sm:h-[250px] lg:h-full object-cover object-center transition-transform duration-700 ease-out group-hover:scale-105"
        loading="lazy"
        decoding="async"
        sizes="384px sm:512px lg:768px"
      />
      <div class="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
    </nuxt-link>

    <div class="p-5 sm:p-6 lg:p-6 xl:p-7 flex flex-col justify-between flex-1 min-w-0 bg-white">
      <div>
        <div class="flex items-center gap-2.5 mb-2.5 text-xs flex-wrap">
          <span class="inline-block bg-[#689F38] text-white font-extrabold px-2.5 py-0.5 rounded text-[0.7rem] uppercase tracking-wider shadow-sm">
            {{ t('n_featured_badge') }}
          </span>
          <span
            v-if="item.categoryName"
            class="text-ink-secondary font-semibold text-[0.82rem]"
          >
            {{ item.categoryName }}
          </span>
          <span class="text-ink-soft text-[0.8rem] font-medium">
            {{ listItemDate(item) }}
          </span>
        </div>

        <h2 class="text-[1.15rem] sm:text-[1.28rem] lg:text-[1.32rem] font-black leading-[1.35] mb-2 m-0 text-ink-strong">
          <nuxt-link
            :to="`/news/${item.slug}`"
            class="text-ink-strong no-underline transition-colors duration-200 hover:text-[#2D5A27]"
          >
            {{ item.title }}
          </nuxt-link>
        </h2>

        <p v-if="item.excerpt" class="text-[0.88rem] text-ink-soft leading-relaxed m-0 line-clamp-2 mb-3">
          {{ cleanExcerpt(item.excerpt) }}
        </p>
      </div>

      <div>
        <nuxt-link
          :to="`/news/${item.slug}`"
          class="inline-flex items-center gap-1.5 text-brand-800 hover:text-[#1B3617] font-bold text-[0.88rem] transition-all no-underline group/link"
        >
          <span>{{ t('n_read_more') }}</span>
          <i class="fa-solid fa-arrow-right text-[0.72rem] transition-transform duration-200 group-hover/link:translate-x-1" aria-hidden="true"></i>
        </nuxt-link>
      </div>
    </div>
  </article>
</template>

<script setup lang="ts">
/**
 * `/news` lead story (page 1, no search): kích thước chuẩn gọn gàng, không bị zoom vỡ ảnh.
 * Display only.
 */
import { cleanExcerpt } from '~/utils/article-excerpt'
import { listItemDate } from '~/utils/news/list-display'
import { useI18n } from '~/composables/useI18n'
import type { PublicArticleListItem } from '~/utils/public-types'

defineProps<{ item: PublicArticleListItem }>()

const { t } = useI18n()
</script>
