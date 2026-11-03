<template>
  <nav
    aria-label="Phân trang bản tin"
    class="flex flex-col sm:flex-row items-center justify-between gap-4 mt-8 pt-6 border-t border-line"
  >
    <div class="text-xs text-[#6F7F6C] font-medium order-2 sm:order-1">
      {{ t('n_pagination_summary').replace('{current}', String(page)).replace('{total}', String(totalPages)) }}
    </div>

    <div class="flex items-center gap-1.5 flex-wrap justify-center order-1 sm:order-2">
      <button
        type="button"
        class="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-[#D5E1D3] bg-white text-ink-secondary text-xs font-bold cursor-pointer transition-all duration-200 hover:border-brand-600 hover:text-brand-600 hover:bg-surface-tint disabled:opacity-30 disabled:cursor-not-allowed"
        :disabled="page <= 1"
        @click="emit('go', page - 1)"
        :aria-label="t('page_prev')"
      >
        <i class="fa-solid fa-chevron-left text-[0.7rem]" aria-hidden="true"></i>
      </button>

      <template v-for="(p, i) in pageRange" :key="p">
        <span
          v-if="i > 0 && p - (pageRange[i - 1] ?? p) > 1"
          class="text-[#8C9C88] text-xs px-1 select-none font-bold"
          aria-hidden="true"
        >&hellip;</span>
        <button
          type="button"
          :aria-current="page === p ? 'page' : undefined"
          :class="[
            'inline-flex items-center justify-center min-w-9 h-9 px-2.5 rounded-lg text-xs font-extrabold cursor-pointer transition-all duration-200',
            page === p
              ? 'bg-brand-600 text-white shadow-sm border border-[#4A6741]'
              : 'bg-white border border-[#D5E1D3] text-ink-secondary hover:border-brand-600 hover:text-brand-600 hover:bg-surface-tint'
          ]"
          @click="emit('go', p)"
        >{{ p }}</button>
      </template>

      <button
        type="button"
        class="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-[#D5E1D3] bg-white text-ink-secondary text-xs font-bold cursor-pointer transition-all duration-200 hover:border-brand-600 hover:text-brand-600 hover:bg-surface-tint disabled:opacity-30 disabled:cursor-not-allowed"
        :disabled="page >= totalPages"
        @click="emit('go', page + 1)"
        :aria-label="t('page_next')"
      >
        <i class="fa-solid fa-chevron-right text-[0.7rem]" aria-hidden="true"></i>
      </button>
    </div>
  </nav>
</template>

<script setup lang="ts">
/**
 * `/news` pagination (Enhanced Pagination): summary, ‹ numbers with gaps › . `go` asks the
 * page to navigate (`setPage`, which also scrolls to `#news-list-top`). Display only.
 */
import { useI18n } from '~/composables/useI18n'

defineProps<{
  page: number
  totalPages: number
  /** Page numbers to show (`pageRange` of utils/pagination). */
  pageRange: number[]
}>()
const emit = defineEmits<{ go: [page: number] }>()

const { t } = useI18n()
</script>
