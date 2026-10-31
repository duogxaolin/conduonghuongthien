<template>
  <PageHero>
    <!-- Breadcrumb navigation -->
    <nav aria-label="Đường dẫn trang" class="mb-4">
      <ol class="flex items-center gap-1.5 text-xs text-ink-muted m-0 p-0 list-none flex-wrap">
        <li class="flex items-center gap-1.5">
          <nuxt-link to="/" class="hover:text-brand-800 transition-colors flex items-center gap-1">
            <i class="fa-solid fa-house text-[0.7rem] text-brand-600" aria-hidden="true"></i>
            <span>{{ t('home') }}</span>
          </nuxt-link>
        </li>
        <li aria-hidden="true" class="text-[#A2B09F]">&rsaquo;</li>
        <li class="font-bold text-[#2A3B27] flex items-center gap-1">
          <span>{{ t('news') }}</span>
          <span v-if="activeCategory !== 'all' && activeCategoryName" class="font-normal text-ink-muted">
            &rsaquo; <span class="font-bold text-[#2A3B27]">{{ activeCategoryName }}</span>
          </span>
        </li>
      </ol>
    </nav>

    <div class="max-w-2xl">
      <div class="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-line border border-[#D0DFCE] text-brand-800 text-[0.72rem] font-extrabold uppercase tracking-wider mb-2.5 shadow-sm">
        <span class="w-2 h-2 rounded-full bg-brand-600 animate-pulse motion-reduce:animate-none" aria-hidden="true"></span>
        <span>{{ t('n_portal_badge') }}</span>
      </div>
      <h1 class="text-2xl sm:text-3xl lg:text-[2.2rem] font-black text-ink-strong tracking-tight leading-[1.2] m-0">
        {{ pageTitle }}
      </h1>
      <p class="text-[0.92rem] sm:text-base text-ink-soft mt-2 mb-0 leading-relaxed">
        {{ t('n_index_desc') }}
      </p>
    </div>
  </PageHero>
</template>

<script setup lang="ts">
/**
 * `/news` hero — hero text đơn giản trên nền gradient nhạt: crumb, badge, the page's only
 * `<h1>`, description. Display only.
 */
import { useI18n } from '~/composables/useI18n'

defineProps<{
  activeCategory: string
  /** Name of the active category (`''` for "all" or an unknown slug). */
  activeCategoryName: string
  pageTitle: string
}>()

const { t } = useI18n()
</script>
