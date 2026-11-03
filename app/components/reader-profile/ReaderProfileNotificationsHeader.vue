<template>
  <header class="mb-4 flex items-center justify-between gap-3">
    <h2 class="m-0 text-[0.95rem] font-extrabold uppercase tracking-wide text-brand-800">
      <i class="fa-solid fa-bell mr-2 text-accent" aria-hidden="true"></i>Thông báo
      <span
        v-if="unreadCount > 0"
        class="ml-1.5 rounded-full bg-danger-soft px-2 py-0.5 text-[0.7rem] font-bold text-white"
      >{{ unreadCount }} mới</span>
    </h2>
    <button
      v-if="unreadCount > 0"
      type="button"
      class="shrink-0 text-[0.8rem] font-semibold text-brand-600 underline transition-colors hover:text-brand-800"
      @click="emit('mark-all')"
    >Đánh dấu tất cả đã đọc</button>
  </header>
</template>

<script setup lang="ts">
/** `/profile`, "Thông báo" heading: the unread count and "mark all read" (the write is the page's). Display only. */
defineProps<{ unreadCount: number }>()
const emit = defineEmits<{ 'mark-all': [] }>()
</script>
