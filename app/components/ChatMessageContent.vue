<template>
  <div v-if="isBot" class="flex flex-col gap-2">
    <!-- Thinking status while actively calling tools -->
    <div
      v-if="hasActiveCall"
      class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-[0.74rem] font-medium bg-surface-tint text-brand-900 border border-line-strong animate-pulse self-start"
    >
      <i class="fa-solid fa-circle-notch animate-spin text-brand-700" aria-hidden="true"></i>
      <span>{{ t('cw_tool_searching') }}</span>
    </div>

    <!-- Main Message Content — markdown tự bọc <p> với whitespace-pre-wrap ở trong; div ngoài
         chỉ break-words + leading-relaxed. Nếu thêm whitespace-pre-wrap ở ngoài, các \n giữa
         các <p> bị tôn trọng thành dòng trống → khoảng cách đôi giữa các câu.
         Mỗi khối một v-html: khi câu trả lời đang stream chỉ khối cuối đổi, các khối
         trên (kể cả ảnh bìa bài viết) giữ nguyên DOM — không bị dựng lại mỗi chunk. -->
    <div class="chat-markdown break-words [overflow-wrap:anywhere] leading-relaxed">
      <div v-for="(block, index) in blocks" :key="index" class="contents" v-html="block"></div>
    </div>

    <!-- Tool Calls (Dev Tracking & Transparency) below message -->
    <details
      class="group mt-2 rounded-xl border border-[#d8e4d6] bg-surface p-2 text-[0.74rem] text-brand-700 transition-all"
    >
      <summary class="flex items-center justify-between font-bold cursor-pointer select-none">
        <span class="flex items-center gap-1.5">
          <i class="fa-solid fa-screwdriver-wrench text-brand-700"></i>
          <span v-if="toolCalls && toolCalls.length > 0">{{ fillPlaceholders(t('cw_tools_used'), { n: toolCalls.length }) }}</span>
          <span v-else class="text-ink-soft font-medium">{{ t('cw_tools_none') }}</span>
        </span>
        <span class="text-[0.68rem] text-ink-muted font-normal group-open:rotate-180 transition-transform">
          <i class="fa-solid fa-chevron-down"></i>
        </span>
      </summary>
      <div class="mt-2 flex flex-col gap-1.5 border-t border-line pt-2">
        <div v-if="toolCalls && toolCalls.length > 0" class="flex flex-col gap-1.5">
          <div
            v-for="(tool, idx) in toolCalls"
            :key="idx"
            class="flex flex-col gap-0.5 rounded-lg border border-line bg-white p-2 font-mono text-[0.7rem]"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="font-bold text-brand-950">{{ tool.label }} ({{ tool.name }})</span>
              <span
                class="rounded px-1.5 py-px text-[0.65rem] font-bold"
                :class="tool.status === 'calling' ? 'bg-amber-100 text-amber-800 animate-pulse' : 'bg-[#e8efe8] text-[#2c6e33]'"
              >
                {{ tool.status === 'calling' ? t('cw_tool_calling') : fillPlaceholders(t(countKey('cw_tool_results', tool.count || 0)), { n: tool.count || 0 }) }}
              </span>
            </div>
            <div v-if="tool.query" class="text-ink-muted truncate">
              &gt; {{ fillPlaceholders(t('cw_tool_query'), { q: tool.query }) }}
            </div>
          </div>
        </div>
        <div v-else class="text-[0.7rem] text-ink-muted italic p-1">
          {{ t('cw_tools_direct_desc') }}
        </div>
      </div>
    </details>
  </div>
  <p v-else class="m-0 whitespace-pre-wrap">{{ text }}</p>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { renderChatMarkdownBlocks } from '~/utils/markdown'
import type { ToolCallExecution } from '~/utils/chatbot-storage'
import { useI18n } from '~/composables/useI18n'
import { countKey, fillPlaceholders } from '~/utils/i18n-placeholders'

const { t } = useI18n()

const props = defineProps<{
  text: string
  isBot?: boolean
  toolCalls?: ToolCallExecution[]
}>()

const blocks = computed(() => (props.isBot ? renderChatMarkdownBlocks(props.text) : []))

const hasActiveCall = computed(() => props.toolCalls?.some(call => call.status === 'calling'))
</script>
