<template>
  <div
    class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6"
    role="status"
    aria-busy="true"
  >
    <span class="sr-only">{{ label }}</span>
    <div
      v-for="n in count"
      :key="n"
      aria-hidden="true"
      class="flex flex-col overflow-hidden rounded-xl border border-[#e2ece3] bg-white"
    >
      <div class="h-[140px] w-full animate-pulse bg-[#f8faf8] motion-reduce:animate-none"></div>
      <div class="flex flex-1 flex-col gap-1 p-3">
        <div class="h-4 w-4/5 animate-pulse rounded bg-[#dfe9e0] motion-reduce:animate-none"></div>
        <div class="h-3 w-1/2 animate-pulse rounded bg-[#edf3ed] motion-reduce:animate-none"></div>
        <div class="mt-1 flex gap-2">
          <div class="h-6 flex-1 animate-pulse rounded-md bg-[#edf3ed] motion-reduce:animate-none"></div>
          <div class="h-6 flex-1 animate-pulse rounded-md bg-[#edf3ed] motion-reduce:animate-none"></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Placeholder for the media library's thumbnail grid (app/pages/admin/media/index.vue).
// The shape is read off the real card: a 140px image band, then the filename, the
// byte size, and the two-button action row — laid out on the same six-column
// responsive ladder, so the page does not reflow when the files arrive.
//
// The grid and height classes are written out literally rather than selected by
// a prop (design.md D1). Tailwind v3 scans source text at build time, so a class
// built by interpolation — `grid-cols-${n}` — is never emitted into the compiled
// stylesheet: the grid silently collapses to one column and nothing errors.
// Never rebuild these by concatenation.
//
// Only `count` varies. A different grid shape would arrive with its own real call
// site and its own measured column count and image height; a variant guessed here
// would be a placeholder that has never been compared against any content.
withDefaults(defineProps<{
  /** Vietnamese description of what is loading; announced to screen readers. */
  label: string
  count?: number
}>(), {
  count: 12,
})
</script>
