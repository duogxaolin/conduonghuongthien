<template>
  <ul class="list-none p-0 m-0">
    <li
      v-for="(item, i) in items"
      :key="item.id"
      class="flex gap-3 py-[13px] border-b border-line last:border-b-0"
    >
      <span class="w-7 shrink-0 text-right text-[1.45rem] leading-[1.15] font-extrabold" :class="i < 3 ? 'text-accent' : 'text-line-strong'">{{ i + 1 }}</span>
      <h3 class="text-[0.9rem] font-bold leading-[1.4] m-0 min-w-0">
        <nuxt-link
          :to="`/news/${item.slug}`"
          class="text-ink no-underline transition-colors duration-300 hover:text-brand-600 line-clamp-2"
        >{{ item.title }}</nuxt-link>
      </h3>
    </li>
  </ul>
</template>

<script setup lang="ts">
/**
 * `/news` rail, "Đọc nhiều" once loaded: ranked links, the top three highlighted. The
 * widget around it — heading, skeleton, empty line — stays on the page. Display only.
 */
defineProps<{ items: Array<{ id: number; slug: string; title: string }> }>()
</script>
