<template>
  <div v-if="isBot" class="chat-markdown" v-html="renderChatMarkdown(text)"></div>
  <p v-else class="m-0 whitespace-pre-wrap">{{ text }}</p>
</template>

<script setup lang="ts">
import { renderChatMarkdown } from '~/utils/markdown'

defineProps<{
  text: string
  isBot?: boolean
}>()
</script>
