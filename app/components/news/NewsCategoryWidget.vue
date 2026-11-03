<template>
  <div class="bg-white rounded-2xl border border-line shadow-sm p-5">
    <div class="flex items-center gap-2 pb-3 border-b border-surface-tint mb-3">
      <span class="w-7 h-7 rounded-lg bg-line text-brand-600 flex items-center justify-center text-xs shadow-sm">
        <i class="fa-solid fa-folder-open" aria-hidden="true"></i>
      </span>
      <h2 class="text-[0.92rem] font-black text-ink-strong uppercase tracking-wide m-0">
        {{ t('n_category_widget') }}
      </h2>
    </div>
    <div class="flex flex-col divide-y divide-surface-tint">
      <button
        type="button"
        class="flex items-center justify-between py-2.5 text-xs font-extrabold text-left transition-colors"
        :class="activeCategory === 'all' ? 'text-brand-800' : 'text-ink-secondary hover:text-brand-800'"
        @click="emit('select', 'all')"
      >
        <span class="flex items-center gap-2">
          <i class="fa-solid fa-layer-group text-[0.7rem] text-[#8CA088]" aria-hidden="true"></i>
          <span>{{ t('n_all_news') }}</span>
        </span>
        <i class="fa-solid fa-chevron-right text-[0.65rem] text-[#A0B09C]" aria-hidden="true"></i>
      </button>
      <button
        v-for="cat in categories"
        :key="cat.id"
        type="button"
        class="flex items-center justify-between py-2.5 text-xs font-extrabold text-left transition-colors"
        :class="activeCategory === cat.slug ? 'text-brand-800' : 'text-ink-secondary hover:text-brand-800'"
        @click="emit('select', cat.slug)"
      >
        <span class="flex items-center gap-2">
          <i :class="categoryIcon(cat.slug)" class="text-[0.7rem] text-[#8CA088]" aria-hidden="true"></i>
          <span>{{ cat.name }}</span>
        </span>
        <i class="fa-solid fa-chevron-right text-[0.65rem] text-[#A0B09C]" aria-hidden="true"></i>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
/** `/news` rail, "Chuyên mục": every root category; `select` → the page's `setCategory`. Display only. */
import { useI18n } from '~/composables/useI18n'
import { categoryIcon } from '~/utils/news/list-display'

defineProps<{
  activeCategory: string
  categories: Array<{ id: number; name: string; slug: string }>
}>()
const emit = defineEmits<{ select: [slug: string] }>()

const { t } = useI18n()
</script>
