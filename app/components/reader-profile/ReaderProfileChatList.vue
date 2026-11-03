<template>
  <ul class="m-0 flex list-none flex-col gap-3 p-0">
    <li v-for="item in items" :key="item.id" class="rounded-lg border border-surface-tint bg-surface p-4">
      <p class="m-0 line-clamp-2 break-words text-[0.9rem] font-semibold leading-snug text-ink">{{ item.title }}</p>
      <p class="mt-1.5 mb-0 text-[0.78rem] text-ink-soft">
        {{ formatDateVN(item.lastMessageAt) }} • {{ item.messageCount }} tin nhắn
      </p>
    </li>
  </ul>
</template>

<script setup lang="ts">
/** `/profile`, "Đoạn chat của tôi" once loaded: each conversation's first question as text. Display only. */
import { formatDateVN } from '~/utils/formatDate'
import type { ReaderChatsPayload } from '~/types/public-api'

defineProps<{ items: ReaderChatsPayload['sessions'] }>()
</script>
