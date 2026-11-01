<script setup lang="ts">
import type { QueueAiVerdict } from '~~/shared/moderation-ai-verdict'
import { queueAiVerdictLabel, queueAiVerdictSummary } from '~/utils/queue-ai-verdict'

/**
 * What the AI judged, noted on a pending queue row whose mark its automatic hide reused
 * (`ai_verdict`, `shared/moderation-ai-verdict.ts`) — on the queue tab of /admin/ai/moderation
 * under the row's own reason, and on /admin/comments under a comment hidden that way. Nothing at
 * all for `null` (rows before the column, rows the AI filed itself, an officer's hide). The label
 * says when the AI judged (`queueAiVerdictLabel`): the verdict may be from an earlier pass.
 *
 * The reason is text a model wrote: interpolated, never `v-html`. Not the "AI: …" badge of the
 * comments page's on-demand scan — that one is not stored, hence the longer label here.
 */
defineProps<{ verdict: QueueAiVerdict | null }>()
</script>

<template>
  <p v-if="verdict" class="m-0 flex items-start gap-1.5 rounded-md border border-line bg-surface px-2 py-1.5 text-xs leading-relaxed text-ink-admin">
    <i class="fa-solid fa-robot mt-0.5 shrink-0 text-danger-soft" aria-hidden="true"></i>
    <span class="min-w-0 break-words">
      <span class="font-semibold text-danger-soft">{{ queueAiVerdictLabel(verdict) }}</span>
      {{ queueAiVerdictSummary(verdict) }}<template v-if="verdict.reason"> — {{ verdict.reason }}</template>
    </span>
  </p>
</template>
