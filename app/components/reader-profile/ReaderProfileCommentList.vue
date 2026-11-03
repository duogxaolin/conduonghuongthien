<template>
  <ul class="m-0 flex list-none flex-col gap-3 p-0">
    <li v-for="item in items" :key="item.id" class="rounded-lg border border-surface-tint bg-surface p-4">
      <div class="mb-2 flex flex-wrap items-center gap-2 text-[0.78rem] text-ink-soft">
        <span class="font-semibold">{{ formatDateVN(item.createdAt) }}</span>
        <span v-if="item.isReply" class="rounded bg-surface-tint px-1.5 py-0.5 font-semibold text-brand-800">Phản hồi</span>
        <span v-if="item.replyCount > 0" class="rounded bg-brand-600 px-1.5 py-0.5 font-semibold text-white">
          {{ item.replyCount }} trả lời
        </span>
      </div>
      <p class="m-0 whitespace-pre-line break-words text-[0.9rem] leading-relaxed text-ink">{{ item.body }}</p>
      <p v-if="item.article" class="mt-2.5 mb-0 text-[0.82rem]">
        <template v-if="item.article.readable">
          <nuxt-link :to="item.article.url" class="font-semibold text-brand-600 no-underline hover:underline">
            {{ item.article.title }}
          </nuxt-link>
        </template>
        <!-- Bài đã ẩn hoặc đã đóng bình luận: nói ra thay vì đưa một
             liên kết dẫn tới một trang không có luồng bình luận nào —
             người đọc sẽ hiểu là bình luận của họ đã bị xoá. -->
        <span v-else class="text-ink-soft">
          {{ item.article.title }}
          <span class="italic">(bài viết hiện không mở bình luận)</span>
        </span>
      </p>
    </li>
  </ul>
</template>

<script setup lang="ts">
/**
 * `/profile`, "Bình luận của tôi" once loaded. The body is text the reader typed: `{{ }}`
 * with `whitespace-pre-line` (their line breaks) and `break-words` — never HTML. Display
 * only.
 */
import { formatDateVN } from '~/utils/formatDate'
import type { ReaderCommentsPayload } from '~/types/public-api'

defineProps<{ items: ReaderCommentsPayload['comments'] }>()
</script>
