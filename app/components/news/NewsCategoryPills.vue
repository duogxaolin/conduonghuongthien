<template>
  <div class="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none flex-wrap">
    <button
      type="button"
      :aria-pressed="activeCategory === 'all'"
      :class="pillClass(activeCategory === 'all')"
      @click="emit('select', 'all')"
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
      @click="emit('select', cat.slug)"
    >
      <i :class="categoryIcon(cat.slug)" aria-hidden="true"></i>
      <span>{{ cat.name }}</span>
    </button>
  </div>

  <div v-if="activeChildren.length" class="flex items-center gap-2 overflow-x-auto pt-2.5 pb-1 sm:flex-wrap text-xs">
    <span class="text-ink-soft font-semibold flex items-center gap-1 shrink-0">
      <i class="fa-solid fa-turn-down text-[0.65rem] rotate-[-90deg]" aria-hidden="true"></i>
      {{ t('n_subtopic') }}
    </span>
    <button
      v-for="child in activeChildren"
      :key="child.id"
      type="button"
      :aria-pressed="activeCategory === child.slug"
      :class="subPillClass(activeCategory === child.slug)"
      @click="emit('select', child.slug)"
    >
      {{ child.name }}
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * `/news` category filter: root chips, then the sub-topics of the active root. The page
 * owns the categories, their loading chips and the navigation (`select` → `setCategory`).
 * Display only.
 */
import { useI18n } from '~/composables/useI18n'
import { categoryIcon } from '~/utils/news/list-display'

type Category = { id: number; name: string; slug: string; parentId: number | null }

defineProps<{
  activeCategory: string
  rootCategories: Category[]
  activeChildren: Category[]
}>()
const emit = defineEmits<{ select: [slug: string] }>()

const { t } = useI18n()

// Visual pill classes
const pillClass = (active: boolean) => [
  'inline-flex items-center gap-2 shrink-0 whitespace-nowrap rounded-full border cursor-pointer px-4 py-2 text-[0.82rem] font-bold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600',
  active
    ? 'bg-brand-600 border-[#4A6741] text-white shadow-sm shadow-brand-600/25'
    : 'bg-white border-[#D5E1D3] text-ink-secondary hover:border-brand-600 hover:text-brand-800 hover:bg-surface-tint'
]

const subPillClass = (active: boolean) => [
  'shrink-0 whitespace-nowrap rounded-lg border cursor-pointer px-3 py-1 font-bold transition-all duration-200 text-xs',
  active
    ? 'bg-brand-800 border-brand-800 text-white shadow-sm'
    : 'bg-white border-line text-[#556350] hover:border-brand-800 hover:text-brand-800 hover:bg-surface-tint'
]
</script>
