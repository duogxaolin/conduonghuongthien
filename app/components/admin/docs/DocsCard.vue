<script setup lang="ts">
import type { AdminDoc } from '~/utils/docs/types'
import { ADMIN_DOC_CATEGORIES } from '~/utils/docs/admin-docs-index'

const props = defineProps<{ doc: AdminDoc }>()

const categoryMeta = computed(() =>
  ADMIN_DOC_CATEGORIES.find(c => c.key === props.doc.category),
)
</script>

<template>
  <NuxtLink
    :to="`/admin/docs/${doc.slug}`"
    class="block bg-white rounded-xl border border-[#e2ece3] p-5 hover:border-[#2c6e33] hover:shadow-md transition-all no-underline"
  >
    <div class="flex items-start gap-3 mb-3">
      <div class="shrink-0 w-10 h-10 rounded-lg bg-[#f0f7f1] flex items-center justify-center text-[#2c6e33]">
        <i :class="doc.icon" class="text-lg" aria-hidden="true"></i>
      </div>
      <div class="flex-1 min-w-0">
        <h3 class="text-[0.95rem] font-bold text-[#122815] m-0 mb-1 leading-snug">{{ doc.title }}</h3>
        <span
          v-if="categoryMeta"
          class="inline-flex items-center gap-1 text-[0.68rem] font-semibold text-[#2c6e33] bg-[#f0f7f1] px-2 py-0.5 rounded-full"
        >
          <i :class="categoryMeta.icon" class="text-[0.55rem]" aria-hidden="true"></i>
          {{ categoryMeta.label }}
        </span>
      </div>
    </div>
    <p class="text-[0.82rem] text-[#425845] m-0 leading-relaxed">{{ doc.summary }}</p>
  </NuxtLink>
</template>
