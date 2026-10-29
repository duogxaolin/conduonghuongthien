<template>
  <ul class="m-0 flex list-none flex-col gap-3 p-0">
    <li v-for="item in items" :key="item.id">
      <component
        :is="item.target ? NuxtLink : 'div'"
        v-bind="item.target ? { to: item.target.url } : {}"
        class="flex gap-3 rounded-lg border p-4 no-underline transition-colors"
        :class="[
          item.isRead ? 'border-surface-tint bg-[#FCFDFC]' : 'border-[#CFDDC8] bg-[#F4F9F0]',
          item.target ? 'cursor-pointer hover:border-accent' : 'cursor-default',
        ]"
        @click="emit('open', item)"
      >
        <span
          class="mt-1.5 h-2 w-2 shrink-0 rounded-full"
          :class="item.isRead ? 'bg-transparent' : 'bg-accent'"
          aria-hidden="true"
        ></span>
        <span class="min-w-0 flex-1">
          <span class="block text-[0.88rem] leading-snug text-ink">
            <strong class="font-bold">{{ item.authorName }}</strong>
            đã trả lời bình luận của bạn
            <span v-if="item.createdAt" class="ml-1 text-[0.78rem] font-normal text-ink-soft">
              • {{ formatDateVN(item.createdAt) }}
            </span>
          </span>
          <span class="mt-1 block break-words text-[0.85rem] leading-relaxed text-ink-secondary">{{ item.excerpt }}</span>
          <span v-if="item.target" class="mt-1.5 block truncate text-[0.78rem] font-semibold text-brand-600">
            {{ item.target.articleTitle }} &rarr;
          </span>
          <!-- Bài đã ẩn hoặc đã đóng bình luận: nói ra thay vì đưa một
               liên kết dẫn tới trang không có luồng bình luận nào. -->
          <span v-else class="mt-1.5 block text-[0.78rem] italic text-ink-soft">
            Bài viết hiện không mở bình luận
          </span>
        </span>
      </component>
    </li>
  </ul>
</template>

<script setup lang="ts">
/**
 * `/profile`, "Thông báo" once loaded. A reachable reply is a real link (`NuxtLink`), so
 * middle-click and "open in new tab" work; `open` tells the page to mark it read — the
 * write is the page's (`useReaderNotifications`). Display only.
 */
import { resolveComponent } from 'vue'
import { formatDateVN } from '~/utils/formatDate'
import type { NotificationItem } from '~/composables/useReaderNotifications'

defineProps<{ items: NotificationItem[] }>()
const emit = defineEmits<{ open: [item: NotificationItem] }>()

// Resolve once so the runtime `:is` binding renders a real <a> — a string name
// would render a literal <nuxtlink> element that navigates nowhere.
const NuxtLink = resolveComponent('NuxtLink')
</script>
