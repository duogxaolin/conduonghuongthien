<!--
  Pending (optimistic) comments — only the sender sees these.
  Dimmed while sending, red on failure with retry/dismiss.

  Chỉ hiển thị (tách từ ArticleComments.vue ở wave3 4.2): danh sách do `useCommentWrites`
  giữ, "Thử lại"/"Bỏ qua" phát lên cho ArticleComments.vue. Thân vẽ bằng `{{ }}`, không
  bao giờ `v-html`.
-->
<template>
  <ul class="list-none p-0 m-0 mb-6 flex flex-col gap-3" :aria-label="t('c_section_title')">
    <li v-for="p in pendingComments" :key="p.tempId" class="transition-opacity">
      <div
        class="rounded-lg p-4 border"
        :class="p.status === 'error'
          ? 'border-[#f0c0c0] bg-[#fff5f4]'
          : 'border-[#E2E8DF] bg-surface opacity-60'"
      >
        <div class="flex items-center gap-2 mb-1.5">
          <span v-if="p.status === 'sending'" class="inline-flex items-center gap-1.5 text-[0.78rem] text-ink-soft font-medium">
            <i class="fa-solid fa-circle-notch fa-spin text-[0.7rem]" aria-hidden="true"></i>
            {{ t('sending') || 'Đang gửi…' }}
          </span>
          <span v-else class="inline-flex items-center gap-1.5 text-[0.78rem] text-danger-soft font-medium" role="alert">
            <i class="fa-solid fa-circle-exclamation text-[0.75rem]" aria-hidden="true"></i>
            {{ p.error }}
          </span>
        </div>
        <p class="m-0 text-[0.95rem] leading-[1.6] text-[#2C3529] whitespace-pre-line break-words">{{ p.body }}</p>
        <div v-if="p.status === 'error'" class="mt-2 flex gap-3">
          <!-- Khoá khi một bình luận khác đang gửi: luồng ghi từ chối thử lại lúc đó (giữ mục
               lại — FINDING-C3), nên nút phải trông và cư xử đúng như vậy thay vì im lặng. -->
          <button
            type="button"
            class="text-[0.82rem] font-semibold text-brand-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 rounded disabled:opacity-50 disabled:cursor-not-allowed disabled:no-underline"
            :disabled="submitting"
            @click="emit('retry', p.tempId)"
          >
            <i class="fa-solid fa-rotate-right mr-1" aria-hidden="true"></i>{{ t('retry') || 'Thử lại' }}
          </button>
          <button type="button" class="text-[0.82rem] font-semibold text-ink-soft hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E2A0A0] rounded" @click="emit('dismiss', p.tempId)">
            <i class="fa-solid fa-xmark mr-1" aria-hidden="true"></i>{{ t('dismiss') || 'Bỏ qua' }}
          </button>
        </div>
      </div>
    </li>
  </ul>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import type { PendingComment } from '~/composables/useCommentWrites'

defineProps<{
  pendingComments: PendingComment[]
  /** Một lượt gửi đang bay — "Thử lại" khoá cho tới khi nó xong. */
  submitting: boolean
}>()
const emit = defineEmits<{ retry: [tempId: number]; dismiss: [tempId: number] }>()

const { t } = useI18n()
</script>
