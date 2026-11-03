<template>
  <div class="mt-2 flex items-center justify-between gap-2 border-t border-line pt-1.5 text-[0.7rem]">
    <span v-if="msg.kind" class="flex items-center gap-1 font-semibold" :class="messageKindClass(msg.kind)" role="status">
      <i class="fa-solid" :class="isProblemKind(msg.kind) ? 'fa-circle-exclamation text-[#9a3412]' : 'fa-circle-check text-[#1e4620]'" aria-hidden="true"></i>
      {{ t(messageKindKey(msg.kind)) }}
    </span>
    <span v-else></span>
    <button
      type="button"
      class="inline-flex items-center gap-1 text-[0.7rem] text-[#6b7280] hover:text-brand-900 bg-transparent border-none cursor-pointer p-0.5 rounded transition-colors"
      @click="emit('copy')"
      :title="t(copiedMsgId === msg.id ? 'cw_copied_title' : 'cw_copy_title')"
    >
      <i :class="copiedMsgId === msg.id ? 'fa-solid fa-check text-accent' : 'fa-regular fa-copy'" aria-hidden="true"></i>
      {{ t(copiedMsgId === msg.id ? 'cw_copied' : 'cw_copy') }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { isProblemKind, messageKindClass, type ChatMessage } from '~/composables/useChatbot'
import { useI18n } from '~/composables/useI18n'
import { messageKindKey } from '~/utils/chat-i18n'

/**
 * The line under a finished answer in the chat widget (`ChatWidget.vue`, wave3 split):
 * what kind of answer it is (approved content, explanation, not found, …) and "Sao chép".
 * Display only — the copy is emitted; the widget writes the clipboard (`useChatCopy`).
 */
defineProps<{
  msg: ChatMessage
  /** The message whose text was just copied (one at a time, for 2 s). */
  copiedMsgId: string | null
}>()
const emit = defineEmits<{ copy: [] }>()
const { t } = useI18n()
</script>
