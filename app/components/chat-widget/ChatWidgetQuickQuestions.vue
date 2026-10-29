<template>
  <div class="flex-shrink-0 border-t border-line">
    <button type="button" class="w-full px-4 py-2 bg-white text-[0.75rem] font-semibold text-ink-secondary flex items-center justify-between border-none cursor-pointer transition-all hover:bg-surface" @click="emit('toggle')">
      <span class="flex items-center gap-1.5"><i class="fa-solid fa-lightbulb text-accent text-[0.7rem]" aria-hidden="true"></i> Câu hỏi gợi ý</span>
      <i class="fa-solid fa-chevron-up text-[0.6rem] transition-transform duration-200" :class="{ 'rotate-180': !isQuickQuestionsExpanded }" aria-hidden="true"></i>
    </button>
    <div v-show="isQuickQuestionsExpanded" class="px-3.5 pb-2.5 bg-white">
      <div class="flex flex-wrap gap-1.5 max-h-[68px] overflow-y-auto overscroll-contain lg:max-h-[96px]">
        <button
          v-for="question in quickQuestions"
          :key="question.id"
          type="button"
          :disabled="isSubmitting"
          @click="emit('ask', question.question)"
          class="bg-surface-tint border border-[#d4e4d2] text-[#2d4a2d] px-2.5 py-1 rounded-full text-[0.72rem] font-medium whitespace-nowrap cursor-pointer transition-all hover:bg-brand-900 hover:text-white hover:border-brand-900 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
        >{{ question.question }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * The approved quick questions above the chat input (`ChatWidget.vue`, wave3 split), as
 * chips under a fold. Display only. Shown by the widget only once they loaded; loading,
 * error and empty are the widget's status line, not this.
 */
defineProps<{
  quickQuestions: { id: string, question: string }[]
  isQuickQuestionsExpanded: boolean
  /** An answer is on its way: the chips wait. */
  isSubmitting: boolean
}>()
const emit = defineEmits<{ toggle: [], ask: [question: string] }>()
</script>
