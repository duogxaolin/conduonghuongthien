<template>
  <div v-if="isBot" class="flex flex-col gap-2">
    <!-- Real-time IDE-style Tool Call Indicator -->
    <div v-if="toolCalls && toolCalls.length > 0" class="flex flex-col gap-1.5 mb-1.5">
      <div
        v-for="(tool, idx) in toolCalls"
        :key="idx"
        class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-[0.74rem] border transition-all"
        :class="tool.status === 'calling' 
          ? 'bg-[#f0f7f1] text-[#1e4620] border-[#c8d6c9] animate-pulse' 
          : 'bg-[#f8faf7] text-[#2c6e33] border-[#d8e4d6]'"
      >
        <span class="flex items-center justify-center w-4 h-4 shrink-0">
          <i v-if="tool.status === 'calling'" class="fa-solid fa-circle-notch animate-spin text-[#2c6e33]" aria-hidden="true"></i>
          <i v-else class="fa-solid fa-check text-[#2c6e33]" aria-hidden="true"></i>
        </span>
        <span class="font-bold">{{ tool.label }}:</span>
        <span v-if="tool.query" class="text-[#4a5545] font-mono text-[0.7rem] truncate max-w-[280px]">&laquo;{{ tool.query }}&raquo;</span>
        <span v-if="tool.status === 'done' && typeof tool.count === 'number'" class="text-[0.68rem] text-[#667768] font-bold bg-white/90 px-1.5 py-0.5 rounded border border-[#e2ece3] ml-auto">
          {{ tool.count > 0 ? `${tool.count} kết quả` : '0 kết quả' }}
        </span>
      </div>
    </div>

    <!-- Main Message Content -->
    <div class="chat-markdown" v-html="renderChatMarkdown(text)"></div>
  </div>
  <p v-else class="m-0 whitespace-pre-wrap">{{ text }}</p>
</template>

<script setup lang="ts">
import { renderChatMarkdown } from '~/utils/markdown'
import type { ToolCallExecution } from '~/utils/chatbot-storage'

defineProps<{
  text: string
  isBot?: boolean
  toolCalls?: ToolCallExecution[]
}>()
</script>
