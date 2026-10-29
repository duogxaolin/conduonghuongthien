<template>
  <div class="mt-4 flex items-center justify-center gap-3">
    <button
      type="button"
      class="rounded-lg border border-line px-3 py-2 text-[0.82rem] font-semibold text-brand-800 disabled:opacity-50"
      :disabled="prevDisabled"
      @click="emit('prev')"
    >Trước</button>
    <span class="text-[0.82rem] text-ink-soft">Trang {{ page }} / {{ totalPages }}</span>
    <button
      type="button"
      class="rounded-lg border border-line px-3 py-2 text-[0.82rem] font-semibold text-brand-800 disabled:opacity-50"
      :disabled="nextDisabled"
      @click="emit('next')"
    >{{ t('profile_next') }}</button>
  </div>
</template>

<script setup lang="ts">
/**
 * `/profile` — the "Trước · Trang x / y · Sau" row under "Thông báo" and "Bình luận của
 * tôi". Which page to load, and when the buttons are off, are the page's. Display only.
 */
import { useI18n } from '~/composables/useI18n'

defineProps<{
  /** The page on screen (the label). */
  page: number
  totalPages: number
  prevDisabled: boolean
  nextDisabled: boolean
}>()
const emit = defineEmits<{ prev: []; next: [] }>()

const { t } = useI18n()
</script>
