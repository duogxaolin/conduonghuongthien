<template>
  <section class="section bg-[#F8FAF7]">
    <div class="container">
      <!-- Section title bar (icon + title) — mirrors the old SectionBar. -->
      <div v-if="d.title" class="flex items-center gap-3 mb-6">
        <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#4A6741] text-white">
          <i :class="d.icon || 'fa-solid fa-building-columns'"></i>
        </span>
        <h2 class="text-[1.4rem] font-extrabold text-[#1E251C]">{{ d.title }}</h2>
      </div>

      <div class="grid grid-cols-1 gap-10 lg:grid-cols-[2fr_1fr]">
        <!-- Left: rich content card -->
        <div class="content-card bg-white p-10 rounded-lg shadow-sm border border-[#E2E8DF] max-md:p-6" v-html="bodyHtml"></div>

        <!-- Right: green organisation sidebar -->
        <div class="flex flex-col">
          <div class="bg-[#4A6741] text-white p-[30px] rounded-lg shadow-md">
            <h4 v-if="d.asideLabel" class="text-[0.85rem] font-bold tracking-[1px] opacity-80 mb-2">{{ d.asideLabel }}</h4>
            <p v-if="d.asideTitle" class="text-[1.2rem] font-extrabold leading-snug mb-1">{{ d.asideTitle }}</p>
            <p v-if="d.asideSubtitle"><strong>{{ d.asideSubtitle }}</strong></p>
            <div v-if="d.asideNote || d.highlightValue" class="h-px bg-white/[0.15] my-5"></div>
            <p v-if="d.asideNote" class="mb-3">{{ d.asideNote }}</p>
            <p v-if="d.highlightLabel"><strong>{{ d.highlightLabel }}</strong></p>
            <p v-if="d.highlightValue" class="text-[1.8rem] font-extrabold text-[#A5D66A] mt-2">{{ d.highlightValue }}</p>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps({ block: { type: Object, required: true } })
const d = computed(() => props.block?.data || {})
const bodyHtml = computed(() => d.value.bodyHtml || '')
</script>

<style scoped>
/* Rich-text styling for the left card v-html — reproduces the old About design
   (green left-bordered headings, justified paragraphs, highlighted list cards).
   :deep() is required because the content is injected via v-html. */
.content-card :deep(h3) {
  font-size: 1.5rem;
  font-weight: 700;
  color: #4A6741;
  margin: 0 0 18px;
  padding-left: 0.75rem;
  border-left: 4px solid #7CB342;
}
.content-card :deep(h3:not(:first-child)) { margin-top: 2.25rem; }
.content-card :deep(p) { font-size: 1rem; color: #4A5545; line-height: 1.75; margin-bottom: 1rem; text-align: justify; }
.content-card :deep(ul) { list-style: none; display: flex; flex-direction: column; gap: 1rem; padding: 0; margin: 0; }
.content-card :deep(li) { background: #F8FAF7; padding: 1rem; border-radius: 0.375rem; border: 1px solid #E2E8DF; color: #4A5545; line-height: 1.7; }
.content-card :deep(li strong) { color: #4A6741; display: block; margin-bottom: 0.375rem; }
.content-card :deep(strong) { font-weight: 700; }
.content-card :deep(a) { color: #4A6741; text-decoration: underline; }
</style>
