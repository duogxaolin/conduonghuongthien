<template>
  <div
    class="flex flex-col gap-5 rounded-xl border border-[#e2ece3] bg-white p-5"
    role="status"
    aria-busy="true"
  >
    <span class="sr-only">{{ label }}</span>
    <div v-for="n in fields" :key="n" class="flex flex-col gap-2" aria-hidden="true">
      <div class="h-3 w-32 animate-pulse rounded bg-[#dfe9e0] motion-reduce:animate-none"></div>
      <div class="h-10 w-full animate-pulse rounded-lg bg-[#edf3ed] motion-reduce:animate-none"></div>
    </div>
    <div
      v-if="hasAction"
      class="h-10 w-36 animate-pulse rounded-lg bg-[#dfe9e0] motion-reduce:animate-none"
      aria-hidden="true"
    ></div>
  </div>
</template>

<script setup lang="ts">
// Placeholder for an administration settings form: a short label bar above a
// full-width input bar, repeated per field, optionally followed by the submit
// button's footprint so the panel does not grow when the form arrives.
withDefaults(defineProps<{
  /** Vietnamese description of what is loading; announced to screen readers. */
  label: string
  fields?: number
  hasAction?: boolean
}>(), {
  fields: 4,
  hasAction: true,
})
</script>
