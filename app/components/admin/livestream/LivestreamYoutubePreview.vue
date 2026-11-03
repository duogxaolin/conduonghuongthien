<script setup lang="ts">
/**
 * What "Lấy thông tin" found for a pasted YouTube address — thumbnail, title, channel.
 * Split out of `pages/admin/livestream/index.vue` (capped at its length, ratchet D-R)
 * to make room for the recording card; markup unchanged.
 */
defineProps<{
  title: string
  author: string
  thumb: string
}>()
</script>

<template>
  <div class="flex gap-3 rounded-lg border border-line bg-white p-3">
    <img
      :src="thumb"
      :alt="title"
      loading="lazy"
      class="w-32 aspect-video object-cover rounded-lg shrink-0"
    />
    <div class="flex flex-col gap-1 min-w-0">
      <span class="text-sm font-bold text-ink line-clamp-2">{{ title }}</span>
      <span v-if="author" class="text-xs text-ink-muted">
        <i class="fa-regular fa-circle-user mr-1" aria-hidden="true"></i>{{ author }}
      </span>
      <span class="text-[0.72rem] text-brand-700 font-semibold mt-auto inline-flex items-center gap-1">
        <i class="fa-solid fa-circle-check" aria-hidden="true"></i>Đã điền tiêu đề
      </span>
    </div>
  </div>
</template>
