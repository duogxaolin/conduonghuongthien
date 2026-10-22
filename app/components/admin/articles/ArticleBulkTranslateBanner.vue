<script setup lang="ts">
/**
 * Banner tiến trình dịch ngầm + banner hoàn tất + banner nhắc kiểm duyệt.
 * Tách khỏi `pages/admin/content/articles/index.vue`.
 *
 * Polling state (`bulkTranslateTask`, `completedBannerMsg`, timer) KHÔNG ở đây
 * — cha giữ vì `fetchArticlesSilent`/`fetchBulkTranslateStatus` cần phối hợp với
 * table chính. Component này thuần presentational: nhận task + loading ref + 2
 * callback (refresh bảng + mở modal dịch toàn bộ).
 *
 * Không có error branch: poll nuốt lỗi (non-critical) —Banner chỉ hiện khi
 * `active` hoặc có `completedBannerMsg`. Dữ liệu giữ nguyên giữa các tick lỗi.
 */
interface BulkTask {
  active: boolean
  task: {
    active: boolean
    total: number
    processed: number
    currentArticleId: number | null
    currentArticleTitle: string | null
    langCode: string
    langName: string
    startedAt: string | null
    completedAt: string | null
  }
  dbTranslatingCount: number
}

const props = defineProps<{
  bulkTranslateTask: BulkTask | null
  completedBannerMsg: string
  loading: boolean
  currentPage: number
  bulkLangs: Array<{ code: string; label: string; flag: string }>
  /** Số bản dịch AI chờ xuất bản (để badge trên nút), 0 = không có. */
  aiPendingTranslations: number
  /** Đang thực hiện bulk publish — disable nút. */
  aiPublishing: boolean
}>()

const emit = defineEmits<{
  'refresh-table': [page: number]
  'fetch-bulk-status': []
  'open-global-translate': []
  'dismiss-completed': []
  'bulk-publish-ai': []
}>()
</script>

<template>
  <!-- Background Translation Task Banner (Live Real-time Progress) -->
  <div
    v-if="props.bulkTranslateTask?.active"
    class="bg-gradient-to-r from-[#f0f7f1] to-[#e4f2e5] border border-[#a2cca4] rounded-xl p-4 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-all"
  >
    <div class="flex items-start sm:items-center gap-3 flex-1 min-w-0">
      <div class="w-10 h-10 rounded-xl bg-[#2c6e33] text-white flex items-center justify-center shrink-0 shadow-xs">
        <i class="fa-solid fa-wand-magic-sparkles text-base animate-spin motion-reduce:animate-none"></i>
      </div>
      <div class="flex flex-col gap-1 flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="px-2 py-0.5 rounded-full bg-[#2c6e33] text-white text-[0.68rem] font-bold uppercase tracking-wider">
            Đang dịch ngầm
          </span>
          <span class="text-xs font-extrabold text-[#122815]">
            {{ props.bulkLangs.find(b => b.code === props.bulkTranslateTask?.task.langCode)?.flag || '🌐' }}
            {{ props.bulkTranslateTask?.task.langName || props.bulkTranslateTask?.task.langCode }}
          </span>
          <span class="text-xs text-[#667768] font-semibold">
            — Tiến độ: {{ props.bulkTranslateTask?.task.processed || 0 }} / {{ props.bulkTranslateTask?.task.total || props.bulkTranslateTask?.dbTranslatingCount }} bài viết
            ({{ Math.round(((props.bulkTranslateTask?.task.processed || 0) / (props.bulkTranslateTask?.task.total || 1)) * 100) }}%)
          </span>
        </div>

        <!-- Animated progress bar -->
        <div class="w-full max-w-lg h-2 rounded-full bg-[#c8dcc9] overflow-hidden">
          <div
            class="h-full bg-[#2c6e33] transition-all duration-500 rounded-full"
            :style="{ width: `${Math.max(5, Math.round(((props.bulkTranslateTask?.task.processed || 0) / (props.bulkTranslateTask?.task.total || 1)) * 100))}%` }"
          ></div>
        </div>

        <p v-if="props.bulkTranslateTask?.task.currentArticleTitle" class="m-0 text-xs text-[#4A5545] truncate" :title="props.bulkTranslateTask.task.currentArticleTitle">
          Đang xử lý: <strong>{{ props.bulkTranslateTask.task.currentArticleTitle }}</strong>
        </p>

        <!-- Alert nhắc nhở kiểm duyệt -->
        <div class="mt-1 p-2 rounded-lg bg-[#fff8e1]/95 border border-[#ffe082] text-[0.7rem] text-[#735100] flex items-center gap-1.5 leading-tight">
          <i class="fa-solid fa-triangle-exclamation text-xs shrink-0 text-[#b78103]"></i>
          <span><strong>Lưu ý kiểm duyệt:</strong> Bài viết sau khi dịch AI xong cần rà soát lại trước khi bấm xuất bản (trừ khi đã chọn Xuất bản luôn).</span>
        </div>
      </div>
    </div>

    <div class="flex items-center gap-2 shrink-0">
      <button
        type="button"
        class="px-3 py-1.5 rounded-lg border border-[#a2cca4] bg-white text-xs font-bold text-[#1e4620] hover:bg-[#e4ece4] transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 shadow-2xs"
        @click="emit('refresh-table', props.currentPage); emit('fetch-bulk-status')"
      >
        <i class="fa-solid fa-arrows-rotate text-[0.7rem]" :class="props.loading ? 'animate-spin' : ''"></i>
        <span>Cập nhật bảng</span>
      </button>
    </div>
  </div>

  <!-- Completed Notice Banner -->
  <div
    v-else-if="props.completedBannerMsg"
    class="bg-[#e4f2e5] border border-[#a2cca4] rounded-xl p-3.5 shadow-sm flex items-center justify-between gap-3 text-xs text-[#1e4620]"
  >
    <div class="flex items-center gap-2">
      <i class="fa-solid fa-circle-check text-base text-[#2c6e33]"></i>
      <span class="font-bold">{{ props.completedBannerMsg }}</span>
    </div>
    <button
      type="button"
      class="border-0 bg-transparent text-[#667768] hover:text-[#122815] cursor-pointer text-xs"
      @click="emit('dismiss-completed')"
    >✕</button>
  </div>

  <!-- Alert thông báo kiểm duyệt & xuất bản bản dịch (Luôn hiển thị khi không có tiến trình chạy ngầm) -->
  <div
    v-else
    class="rounded-xl border border-[#ffe082] bg-[#fffdf7] p-3.5 shadow-2xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-[#735100]"
  >
    <div class="flex items-start sm:items-center gap-3">
      <div class="w-8 h-8 rounded-lg bg-[#fff8e1] border border-[#ffe082] flex items-center justify-center shrink-0 text-[#b78103] text-sm mt-0.5 sm:mt-0">
        <i class="fa-solid fa-triangle-exclamation"></i>
      </div>
      <div class="flex flex-col gap-0.5">
        <span class="font-extrabold text-[#735100] text-sm">Lưu ý kiểm duyệt & Xuất bản bản dịch AI:</span>
        <span class="text-[#8a6500]">
          Các bài viết dịch bằng AI được lưu ở trạng thái <strong>Bản nháp AI</strong> (huy hiệu vàng <span class="px-1.5 py-px rounded bg-[#fff8e1] text-[#b78103] border border-[#ffe082] font-bold text-[0.68rem]">EN</span>, <span class="px-1.5 py-px rounded bg-[#fff8e1] text-[#b78103] border border-[#ffe082] font-bold text-[0.68rem]">ZH</span>...). Cán bộ bấm vào huy hiệu để <strong>Xem nhanh</strong> và rà soát trước khi bấm <strong>Xuất bản</strong> ra trang công khai.
        </span>
      </div>
    </div>
    <div class="flex flex-wrap items-center gap-2 shrink-0">
      <button
        type="button"
        class="px-3.5 py-2 rounded-lg border border-[#c8d6c9] bg-white text-xs font-bold text-[#1e4620] hover:bg-[#f0f7f1] transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 shadow-2xs"
        @click="emit('open-global-translate')"
      >
        <i class="fa-solid fa-wand-magic-sparkles text-[0.7rem]"></i>
        <span>Dịch toàn bộ bài viết</span>
      </button>
      <button
        type="button"
        class="px-3.5 py-2 rounded-lg bg-[#2c6e33] text-white text-xs font-bold hover:bg-[#245928] transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 shadow-2xs disabled:opacity-50 disabled:cursor-not-allowed"
        :disabled="props.aiPublishing || props.aiPendingTranslations === 0"
        :title="props.aiPendingTranslations === 0 ? 'Không có bản dịch AI nào sẵn sàng xuất bản' : `Xuất bản ${props.aiPendingTranslations} bản dịch AI đang chờ`"
        @click="emit('bulk-publish-ai')"
      >
        <i class="fa-solid fa-rocket text-[0.7rem]"></i>
        <span>Xuất bản toàn bộ bản dịch AI</span>
        <span
          v-if="props.aiPendingTranslations > 0"
          class="ml-0.5 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-white text-[#2c6e33] text-[0.65rem] font-extrabold leading-none"
        >{{ props.aiPendingTranslations }}</span>
      </button>
    </div>
  </div>
</template>
