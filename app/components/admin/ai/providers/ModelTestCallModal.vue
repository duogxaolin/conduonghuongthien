<script setup lang="ts">
/**
 * "Test Call" result dialog of one model: success (time, tokens, estimated cost, the reply)
 * or the failure sentence. The reply and the error are printed as text (`{{ }}`), never as
 * HTML. Display only; the call itself is `useAiModelWrites.testCallModel`.
 */
import AdminModal from '~/components/admin/AdminModal.vue'
import { formatVnd } from '~/utils/ai-service-labels'
import type { ModelTestResult } from '~/composables/useAiModelWrites'

defineProps<{
  /** The last test call; null = closed. */
  result: ModelTestResult | null
}>()
defineEmits<{ close: [] }>()
</script>

<template>
  <AdminModal
    :open="!!result"
    :title="`Test Call: ${result?.model ?? ''}`"
    icon="fa-solid fa-bolt"
    size="lg"
    @close="$emit('close')"
  >
    <div v-if="result" class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="m-0 text-xs text-ink-muted">Nhà cung cấp: <strong>{{ result.provider }}</strong></p>
        <span
          class="px-2.5 py-1 rounded-full text-xs font-bold"
          :class="!result.error ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'"
        >
          {{ !result.error ? 'Thành công (200 OK)' : 'Thất bại' }}
        </span>
      </div>

      <!-- Metrics if success -->
      <div v-if="!result.error" class="grid grid-cols-3 gap-2 p-3 rounded-xl bg-surface text-xs">
        <div>
          <span class="text-ink-muted">Thời gian</span>
          <p class="m-0 font-bold text-brand-950 font-mono">{{ result.durationMs }}ms</p>
        </div>
        <div>
          <span class="text-ink-muted">Tokens tiêu thụ</span>
          <p class="m-0 font-bold text-brand-950 font-mono">{{ result.usage.totalTokens }} ({{ result.usage.promptTokens }} in / {{ result.usage.completionTokens }} out)</p>
        </div>
        <div>
          <span class="text-ink-muted">Chi phí ước tính</span>
          <p class="m-0 font-bold text-brand-700 font-mono">{{ formatVnd(result.costVnd) }}</p>
        </div>
      </div>

      <!-- Response text or error -->
      <div v-if="!result.error" class="flex flex-col gap-1.5">
        <span class="text-xs font-bold text-ink-muted uppercase">Phản hồi từ Model:</span>
        <div class="rounded-xl border border-line-strong bg-surface p-3.5 text-sm text-brand-950 whitespace-pre-wrap font-sans leading-relaxed max-h-[220px] overflow-y-auto">
          {{ result.reply }}
        </div>
      </div>
      <div v-else class="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-700 font-mono whitespace-pre-wrap">
        {{ result.error }}
      </div>
    </div>
    <template #footer>
      <button type="button" class="px-5 py-2 rounded-lg bg-brand-700 text-white text-sm font-semibold hover:bg-brand-900" @click="$emit('close')">
        Đóng
      </button>
    </template>
  </AdminModal>
</template>
