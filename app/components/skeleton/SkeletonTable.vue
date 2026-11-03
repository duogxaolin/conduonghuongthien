<template>
  <div
    class="overflow-hidden rounded-xl border border-line bg-white"
    role="status"
    aria-busy="true"
  >
    <span class="sr-only">{{ label }}</span>

    <div class="flex gap-4 border-b border-line bg-surface px-4 py-3" aria-hidden="true">
      <div
        v-for="c in cols"
        :key="`h-${c}`"
        class="h-3 flex-1 animate-pulse rounded bg-line motion-reduce:animate-none"
      ></div>
    </div>

    <div
      v-for="r in rows"
      :key="`r-${r}`"
      class="flex gap-4 border-t border-surface-tint px-4 py-4 first:border-t-0"
      aria-hidden="true"
    >
      <div
        v-for="c in cols"
        :key="`r-${r}-c-${c}`"
        class="h-4 flex-1 animate-pulse rounded bg-surface-tint motion-reduce:animate-none"
      ></div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Placeholder for an administration data table. `cols` must match the real
// table's column count so the transition to content does not reflow the page
// (spec: "Loading placeholders SHALL match the shape of the content they
// replace").
//
// The header strip is unconditional: every one of the ten call sites stands in
// for a table that has a header row. A prop to switch it off would have no caller
// to derive its behaviour from.
//
// Palette and ARIA shape generalised from app/pages/admin/analytics.vue:236.
withDefaults(defineProps<{
  /** Vietnamese description of what is loading; announced to screen readers. */
  label: string
  rows?: number
  cols?: number
}>(), {
  rows: 5,
  cols: 4,
})
</script>
