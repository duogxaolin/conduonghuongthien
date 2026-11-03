<script setup lang="ts" generic="T extends SearchableDoc">
import { detectIntent, searchDocs, type SearchableDoc, type SearchResult, type SearchIntent } from '~/utils/docs/search'

const props = defineProps<{ docs: T[] }>()
const emit = defineEmits<{ results: [SearchResult<T>[]], query: [string] }>()

const query = defineModel<string>({ default: '' })

const intent = computed<SearchIntent>(() => detectIntent(query.value))
const results = computed<SearchResult<T>[]>(() => {
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
      <i class="fa-solid fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-ink-faint text-sm" aria-hidden="true"></i>
      <input
        v-model="query"
        type="text"
        placeholder="Hỏi bất kỳ: 'làm sao đăng bài', 'backup ở đâu', 'MFA là gì'..."
        maxlength="200"
        class="w-full pl-11 pr-4 py-3 border border-line-strong rounded-xl text-sm text-brand-950 outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15 box-border bg-white"
      />
      <span
        v-if="intent !== 'keyword' && query.trim()"
        class="absolute right-4 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-tint border border-brand-700/20 text-[0.72rem] font-bold text-brand-700 whitespace-nowrap"
      >
        <i class="fa-solid fa-wand-magic-sparkles text-[0.6rem]" aria-hidden="true"></i>
        {{ intentLabels[intent] }}
      </span>
    </div>
  </div>
</template>
