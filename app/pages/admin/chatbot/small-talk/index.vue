<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin-auth' })
await navigateTo({ path: '/admin/chatbot/knowledge', query: { tab: 'small-talk' } }, { replace: true })
</script>
<template>
  <div class="rounded-xl border border-[#e2ece3] bg-white p-8 text-center text-sm text-[#667768]" aria-live="polite">Đang chuyển tới kho nội dung Chatbot...</div>
</template>
