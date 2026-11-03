<template>
  <div class="w-full lg:w-80 shrink-0">
    <form @submit.prevent="emit('submit')" class="relative flex items-center">
      <span class="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#7C8D78] pointer-events-none text-xs">
        <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
      </span>
      <input
        v-model="draft"
        type="text"
        :placeholder="t('n_search_placeholder')"
        :aria-label="t('n_search_placeholder')"
        class="w-full pl-9 pr-20 py-2.5 bg-white rounded-xl border border-[#D5E1D3] text-sm text-ink placeholder-[#8A9986] focus:border-brand-600 focus:ring-2 focus:ring-brand-600/30 focus:outline-none transition-all shadow-sm"
      />
      <button
        v-if="draft"
        type="button"
        @click="emit('clear')"
        class="absolute right-12 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center text-[#97A593] hover:text-ink-secondary text-xs transition-colors"
        title="Xóa chữ"
        aria-label="Xóa từ khóa tìm kiếm"
      >
        ✕
      </button>
      <button
        type="submit"
        class="absolute right-1.5 top-1/2 -translate-y-1/2 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-800 text-white text-xs font-bold transition-all shadow-sm"
      >
        {{ t('n_search_btn_short') }}
      </button>
    </form>
  </div>
</template>

<script setup lang="ts">
/**
 * `/news` search box. The draft is the page's `searchInput` (`v-model`); submitting and
 * clearing are the page's to do — they navigate (the URL is the source of truth,
 * usePublicArticleList). Display only.
 */
import { useI18n } from '~/composables/useI18n'

const draft = defineModel<string>({ required: true })
const emit = defineEmits<{ submit: []; clear: [] }>()

const { t } = useI18n()
</script>
