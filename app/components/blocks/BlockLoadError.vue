<template>
  <!-- Nhánh lỗi dùng chung của các khối trang chủ đọc `/api/public/articles`.
       Cùng hình dạng với nhánh lỗi của `NewsCategoryList.vue` (khung viền đứt
       đỏ nhạt + nút "Thử lại"), để một lượt tải hỏng không còn hiện ra như
       "chưa có bài nào". Khối cha giữ `refresh` và quyết định khi nào hiện. -->
  <div
    role="alert"
    class="bg-white border-2 border-dashed border-[#F0B8B8] px-6 py-10 rounded-2xl text-center shadow-sm"
  >
    <div class="w-12 h-12 rounded-full bg-[#FCE8E8] text-[#C62828] flex items-center justify-center mx-auto mb-3 text-lg">
      <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
    </div>
    <h3 class="text-base font-extrabold text-[#992222] m-0 mb-1">{{ title }}</h3>
    <p class="text-sm text-[#667768] m-0 mb-4">{{ description }}</p>
    <button
      type="button"
      class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#4A6741] text-white text-xs font-bold hover:bg-[#385132] transition-all cursor-pointer border-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A6741] focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-wait"
      :disabled="retrying"
      :aria-busy="retrying ? 'true' : undefined"
      @click="emit('retry')"
    >
      <i
        class="fa-solid fa-rotate-right"
        :class="retrying ? 'animate-spin motion-reduce:animate-none' : ''"
        aria-hidden="true"
      ></i>
      <span>{{ retryLabel }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title: string
  description: string
  retryLabel: string
  /** Đang tải lại — khoá nút để một cú bấm kép không bắn hai lượt. */
  retrying?: boolean
}>()

const emit = defineEmits<{ retry: [] }>()
</script>
