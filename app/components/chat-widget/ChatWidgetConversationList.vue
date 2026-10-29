<template>
  <div class="flex-shrink-0 border-b border-line bg-white max-h-[40%] overflow-y-auto overscroll-contain">
    <div class="flex items-center justify-between px-3 py-2 border-b border-surface-tint">
      <span class="text-[0.72rem] font-bold uppercase tracking-wide text-[#6b7280]">Cuộc trò chuyện</span>
      <button type="button" class="flex items-center gap-1 rounded-full bg-brand-900 px-2.5 py-1 text-[0.7rem] font-bold text-white border-none cursor-pointer hover:bg-[#153317]" @click="emit('create')">
        <i class="fa-solid fa-plus text-[0.6rem]" aria-hidden="true"></i> Tạo mới
      </button>
    </div>
    <ul class="list-none m-0 p-0">
      <li v-for="conversation in conversations" :key="conversation.id" class="border-b border-surface last:border-b-0">
        <div class="flex items-center gap-1 px-2 py-1.5" :class="{ 'bg-surface-tint': conversation.id === activeId }">
          <button
            type="button"
            class="flex-1 min-w-0 text-left bg-transparent border-none cursor-pointer px-1 py-0.5"
            :aria-current="conversation.id === activeId ? 'true' : undefined"
            @click="emit('switch', conversation.id)"
          >
            <span class="block truncate text-[0.78rem] font-semibold" :class="conversation.id === activeId ? 'text-[#1e4620]' : 'text-[#374151]'">{{ conversation.title }}</span>
            <span class="block text-[0.65rem] text-[#9ca3af]">{{ conversationMeta(conversation) }}</span>
          </button>
          <button type="button" class="w-6 h-6 flex-shrink-0 rounded-full bg-transparent border-none text-[#9ca3af] cursor-pointer hover:bg-[#fee2e2] hover:text-[#b42318]" @click="emit('delete', conversation.id)" :aria-label="`Xóa ${conversation.title}`">
            <i class="fa-solid fa-trash-can text-[0.65rem]"></i>
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import type { StoredConversation } from '~/composables/useChatbot'

/**
 * The conversation list under the chat dialog's header (`ChatWidget.vue`, wave3 split).
 * Display only: create / switch / delete are emitted; the widget runs them through
 * `useChatbot` and closes the list.
 */
defineProps<{
  conversations: StoredConversation[]
  activeId: string
}>()
const emit = defineEmits<{ create: [], switch: [id: string], delete: [id: string] }>()

const conversationMeta = (conversation: StoredConversation) => {
  const count = conversation.messages.filter(item => item.id !== 'welcome').length
  const when = new Date(conversation.createdAt)
  const stamp = Number.isNaN(when.getTime()) ? '' : when.toLocaleDateString('vi-VN')
  return count ? `${count} tin nhắn · ${stamp}` : `Chưa có tin nhắn · ${stamp}`
}
</script>
