<template>
  <!-- Câu hỏi gợi ý tiếp theo dưới câu trả lời mới nhất. Mỗi câu đã được server
       đối chiếu với kho tri thức đã duyệt (`server/utils/chatbot/follow-ups.ts`),
       nên bấm vào là hỏi được ngay. -->
  <div role="group" :aria-labelledby="labelId" class="flex flex-col items-start gap-1.5 animate-fade-slide-up motion-reduce:animate-none">
    <p :id="labelId" class="m-0 flex items-center gap-1.5 text-[0.72rem] font-semibold text-[#667768]">
      <i class="fa-solid fa-lightbulb text-[0.68rem] text-[#7CB342]" aria-hidden="true"></i>
      Có thể bạn muốn hỏi tiếp
    </p>
    <button
      v-for="question in questions"
      :key="question"
      type="button"
      :disabled="disabled"
      class="group inline-flex max-w-full items-start gap-2 rounded-2xl border border-[#d4e4d2] bg-white px-3.5 py-2 text-left text-[0.82rem] font-medium leading-snug text-[#2d4a2d] shadow-[0_1px_2px_rgba(0,0,0,0.04)] cursor-pointer transition-colors hover:border-[#1e4620] hover:bg-[#f0f6ef] active:bg-[#e4f0e2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A6741] disabled:cursor-not-allowed disabled:opacity-50 md:py-1.5"
      @click="$emit('ask', question)"
    >
      <i class="fa-solid fa-arrow-right mt-[4px] text-[0.62rem] text-[#7CB342] group-hover:text-[#1e4620]" aria-hidden="true"></i>
      <span class="break-words [overflow-wrap:anywhere]">{{ question }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { useId } from 'vue'

// The widget and /assistant can show the same conversation at once.
const labelId = `chat-follow-ups-${useId()}`

defineProps<{
  questions: string[]
  disabled?: boolean
}>()
defineEmits<{ ask: [question: string] }>()
</script>
