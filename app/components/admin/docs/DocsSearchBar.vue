<script setup lang="ts">
import { detectIntent, searchDocs, type SearchResult, type SearchIntent } from '~/utils/docs/search'
import type { AdminDoc } from '~/utils/docs/admin-docs-index'

const props = defineProps<{ docs: AdminDoc[] }>()
const emit = defineEmits<{ results: [SearchResult<AdminDoc>[]], query: [string] }>()

const query = defineModel<string>({ default: '' })

const intent = computed<SearchIntent>(() => detectIntent(query.value))
const results = computed<SearchResult<AdminDoc>[]>(() => {
  if (!query.value.trim()) return []
  return searchDocs(props.docs, query.value)
})

watch(results, (val) => { emit('results', val) }, { immediate: true })
watch(query, (val) => { emit('query', val) })

const intentLabels: Record<SearchIntent, string> = {
  procedure: 'Tìm quy trình',
  explanation: 'Giải thích',
  location: 'Định vị',
  definition: 'Định nghĩa',
  keyword: '',
}
</script>

<template>
  <div class="w-full">
    <div class="relative">
      <i class="fa-solid fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-[#8a9a8c] text-sm" aria-hidden="true"></i>
      <input
        v-model="query"
        type="text"
        placeholder="Hỏi bất kỳ: 'làm sao đăng bài', 'backup ở đâu', 'MFA là gì'..."
        maxlength="200"
        class="w-full pl-11 pr-4 py-3 border border-[#c8d6c9] rounded-xl text-sm text-[#122815] outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border bg-white"
      />
      <span
        v-if="intent !== 'keyword' && query.trim()"
        class="absolute right-4 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#f0f7f1] border border-[#2c6e33]/20 text-[0.72rem] font-bold text-[#2c6e33] whitespace-nowrap"
      >
        <i class="fa-solid fa-wand-magic-sparkles text-[0.6rem]" aria-hidden="true"></i>
        {{ intentLabels[intent] }}
      </span>
    </div>
  </div>
</template>
