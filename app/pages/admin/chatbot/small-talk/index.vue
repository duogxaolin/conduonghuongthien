<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin-auth' })
await navigateTo({ path: '/admin/chatbot/knowledge', query: { tab: 'small-talk' } }, { replace: true })
</script>
<template>
  <div class="rounded-xl border border-line bg-white p-8 text-center text-sm text-ink-muted" aria-live="polite">Đang chuyển tới kho nội dung Chatbot...</div>
</template>
