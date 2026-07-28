<script setup lang="ts">
/**
 * The strip that appears above a list once rows are selected.
 *
 * Rendering is the caller's decision (`v-if="selection.count.value"`), so this
 * component never has to know which list it sits on. Action buttons arrive
 * through the default slot: what "bulk" means differs per resource — articles
 * archive, users get locked, submissions only delete.
 *
 * `aria-live` matters here: the count changes as checkboxes are ticked, and a
 * screen-reader user gets no other signal that the selection grew.
 */
const props = defineProps<{
  count: number
  /** Shown while a bulk request is in flight; disables the whole strip. */
  busy?: boolean
  /** Noun for the count, e.g. "bài viết". Defaults to the generic "mục". */
  noun?: string
}>()

const emit = defineEmits<{ clear: [] }>()

const label = computed(() => `Đã chọn ${props.count} ${props.noun || 'mục'}`)
</script>

<template>
  <div
    class="flex flex-col gap-3 rounded-xl border border-[#2c6e33] bg-[#f0f7f1] p-3 sm:flex-row sm:items-center sm:justify-between"
    role="status"
    aria-live="polite"
  >
    <span class="text-sm font-bold text-[#1e4620]">{{ label }}</span>
    <div class="flex flex-wrap items-center gap-2" :class="busy ? 'pointer-events-none opacity-60' : ''">
      <slot />
      <button
        type="button"
        :disabled="busy"
        class="rounded-lg border border-[#c8d6c9] bg-white px-3 py-2 text-sm font-semibold text-[#2c3e2e] hover:bg-white/70 focus:outline-none focus:ring-2 focus:ring-[#2c6e33]/30 disabled:cursor-not-allowed disabled:opacity-60"
        @click="emit('clear')"
      >
        Bỏ chọn
      </button>
    </div>
  </div>
</template>
