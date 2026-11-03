<script setup lang="ts">
import type { QueueAiVerdict } from '~~/shared/moderation-ai-verdict'

/**
 * "Đã ẩn — <lý do>" under a hidden comment on /admin/comments and, when the hide is an automatic
 * one that reused a pending queue row's mark, what the AI judged (`aiVerdict` from
 * `listCommentsForAdmin` — `null` for an officer's hide, or when the AI noted nothing). Moved out
 * of the page so it does not grow (file-length ratchet); the line's colour is still the page's,
 * passed as `class` on this component.
 */
defineProps<{ reason: string | null, aiVerdict: QueueAiVerdict | null }>()
</script>

<template>
  <div class="mt-1.5 text-[0.75rem]">
    <div class="flex items-center gap-1.5">
      <i class="fa-solid fa-eye-slash" aria-hidden="true"></i>
      <span class="font-semibold">Đã ẩn</span>
      <span v-if="reason" class="text-ink-muted font-normal">— {{ reason }}</span>
    </div>
    <AdminQueueAiVerdictNote :verdict="aiVerdict" class="mt-1" />
  </div>
</template>
