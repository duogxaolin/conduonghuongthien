<template>
  <div v-if="isBot" class="flex flex-col gap-2">
    <!-- Thinking status while actively calling tools -->
    <div
      v-if="hasActiveCall"
      class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-[0.74rem] font-medium bg-[#f0f7f1] text-[#1e4620] border border-[#c8d6c9] animate-pulse self-start"
    >
      <i class="fa-solid fa-circle-notch animate-spin text-[#2c6e33]" aria-hidden="true"></i>
      <span>Đang tra cứu dữ liệu thực tế từ hệ thống...</span>
    </div>

    <!-- Main Message Content -->
    <div class="chat-markdown" v-html="renderChatMarkdown(text)"></div>

    <!-- Tool Calls (Dev Tracking & Transparency) below message -->
    <details
      class="group mt-2 rounded-xl border border-[#d8e4d6] bg-[#f8faf7] p-2 text-[0.74rem] text-[#2c6e33] transition-all"
    >
      <summary class="flex items-center justify-between font-bold cursor-pointer select-none">
        <span class="flex items-center gap-1.5">
          <i class="fa-solid fa-screwdriver-wrench text-[#2c6e33]"></i>
          <span v-if="toolCalls && toolCalls.length > 0">Công cụ AI đã sử dụng ({{ toolCalls.length }})</span>
          <span v-else class="text-[#556450] font-medium">Công cụ AI: Trả lời trực tiếp</span>
        </span>
        <span class="text-[0.68rem] text-[#667768] font-normal group-open:rotate-180 transition-transform">
          <i class="fa-solid fa-chevron-down"></i>
        </span>
      </summary>
      <div class="mt-2 flex flex-col gap-1.5 border-t border-[#e2ece3] pt-2">
        <div v-if="toolCalls && toolCalls.length > 0" class="flex flex-col gap-1.5">
          <div
            v-for="(tool, idx) in toolCalls"
            :key="idx"
            class="flex flex-col gap-0.5 rounded-lg border border-[#e2ece3] bg-white p-2 font-mono text-[0.7rem]"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="font-bold text-[#122815]">{{ tool.label }} ({{ tool.name }})</span>
              <span
                class="rounded px-1.5 py-0.2 text-[0.65rem] font-bold"
                :class="tool.status === 'calling' ? 'bg-amber-100 text-amber-800 animate-pulse' : 'bg-[#e8efe8] text-[#2c6e33]'"
              >
                {{ tool.status === 'calling' ? 'Đang gọi...' : (tool.count ? `${tool.count} kết quả` : '0 kết quả') }}
              </span>
            </div>
            <div v-if="tool.query" class="text-[#667768] truncate">
              &gt; Truy vấn: &laquo;{{ tool.query }}&raquo;
            </div>
          </div>
        </div>
        <div v-else class="text-[0.7rem] text-[#667768] italic p-1">
          Lượt hội thoại này model AI phân tích câu hỏi và trả lời trực tiếp mà không cần kích hoạt công cụ tra cứu thêm.
        </div>
      </div>
    </details>
  </div>
  <p v-else class="m-0 whitespace-pre-wrap">{{ text }}</p>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { renderChatMarkdown } from '~/utils/markdown'
import type { ToolCallExecution } from '~/utils/chatbot-storage'

const props = defineProps<{
  text: string
  isBot?: boolean
  toolCalls?: ToolCallExecution[]
}>()

const hasActiveCall = computed(() => props.toolCalls?.some(t => t.status === 'calling'))
</script>
