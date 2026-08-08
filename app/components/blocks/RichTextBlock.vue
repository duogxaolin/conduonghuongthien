<template>
  <section class="section bg-white">
    <div class="container">
      <div class="article-body max-w-[760px] mx-auto text-[#2b352a]" v-html="html"></div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps({ block: { type: Object, required: true } })
const html = computed(() => props.block?.data?.html || '')
</script>

<style scoped>
/* Rich-text content styling for v-html output (same pattern as the articles renderer). */
.article-body :deep(h2) { font-size: 1.5rem; font-weight: 800; color: #1E251C; margin: 1.4rem 0 0.8rem; }
.article-body :deep(h3) { font-size: 1.2rem; font-weight: 800; color: #1E251C; margin: 1.2rem 0 0.6rem; }
.article-body :deep(p) { line-height: 1.75; margin-bottom: 1rem; }
.article-body :deep(ul), .article-body :deep(ol) { padding-left: 1.4rem; margin-bottom: 1rem; line-height: 1.75; }
.article-body :deep(ul) { list-style: disc; }
.article-body :deep(ol) { list-style: decimal; }
.article-body :deep(a) { color: #4A6741; text-decoration: underline; }
.article-body :deep(img) { max-width: 100%; border-radius: 0.5rem; margin: 1rem 0; }
.article-body :deep(blockquote) { border-left: 3px solid #7CB342; padding-left: 1rem; color: #4A5545; font-style: italic; margin: 1rem 0; }
.article-body :deep(strong) { font-weight: 700; }
</style>
