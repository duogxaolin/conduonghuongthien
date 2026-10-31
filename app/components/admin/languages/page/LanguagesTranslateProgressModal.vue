<script setup lang="ts">
/**
 * Hộp "Tiến trình Dịch AI" của `/admin/languages`. Tách khỏi `pages/admin/languages/index.vue`
 * (wave3 4.2): chỉ hiển thị — tiến độ và nhật ký vào qua props (lượt dịch chạy ở
 * `useLanguageBatchTranslate`), "Dừng lại" phát `stop`, mọi lối đóng phát `close`.
 *
 * Đang dịch = bận: Escape/✕/bấm nền không đóng (như trước — chỉ nút "Đóng cửa sổ" và "Dừng
 * lại" ở chân).
 */
import AdminModal from '~/components/admin/AdminModal.vue'
import type { TranslateLogLine, TranslateProgress } from '~/types/admin-languages'

defineProps<{
  open: boolean
  title: string
  progressStats: TranslateProgress
  progressLog: TranslateLogLine[]
}>()

const emit = defineEmits<{ 'close': [], 'stop': [] }>()
</script>

<template>
  <AdminModal
    :open="open"
    :title="title"
    :icon="!progressStats.finished && !progressStats.stopped ? 'fa-solid fa-wand-magic-sparkles animate-spin motion-reduce:animate-none' : 'fa-solid fa-wand-magic-sparkles'"
    :busy="!progressStats.finished && !progressStats.stopped"
    @close="emit('close')"
  >
    <div class="flex flex-col gap-4">
      <p class="m-0 text-xs text-ink-muted">Dịch tự động các chuỗi giao diện qua AI Gateway</p>

      <div class="flex flex-col gap-2 bg-surface p-3.5 rounded-lg border border-line">
        <div class="flex items-center justify-between text-xs font-bold">
          <span class="text-brand-950">
            {{ progressStats.finished ? '✓ Hoàn tất bản dịch' : (progressStats.stopped ? '⏹ Đã dừng tiến trình' : 'Đang xử lý...') }}
          </span>
          <span class="text-brand-900 text-sm">{{ progressStats.percent }}%</span>
        </div>

        <div class="w-full h-2.5 bg-line rounded-full overflow-hidden">
          <div
            class="h-full bg-brand-700 transition-all duration-300 rounded-full"
            :class="!progressStats.finished && !progressStats.stopped ? 'animate-pulse motion-reduce:animate-none' : ''"
            :style="{ width: `${progressStats.percent}%` }"
          ></div>
        </div>

        <div class="flex items-center justify-between text-[0.72rem] text-ink-muted">
          <span>Đã dịch: <strong class="text-brand-950">{{ progressStats.done }} / {{ progressStats.total }}</strong> key</span>
          <span class="truncate max-w-[220px]" :title="progressStats.currentKey">{{ progressStats.currentKey }}</span>
        </div>
      </div>

      <div>
        <h4 class="text-xs font-bold text-brand-950 mb-1.5 flex items-center justify-between">
          <span>Nhật ký dịch theo thời gian thực ({{ progressLog.length }} mục)</span>
          <span v-if="!progressStats.finished && !progressStats.stopped" class="text-[0.68rem] text-brand-700 font-normal flex items-center gap-1">
            <span class="w-1.5 h-1.5 rounded-full bg-brand-700 animate-ping"></span> Đang nạp...
          </span>
        </h4>
        <div class="h-44 overflow-y-auto border border-line rounded-lg p-2 bg-surface flex flex-col gap-1 text-xs font-mono">
          <div
            v-for="(item, idx) in progressLog"
            :key="idx"
            class="px-2 py-1 rounded bg-white border flex items-start gap-1.5"
            :class="item.success ? 'border-[#e2ece3] text-brand-950' : 'border-[#ffebe9] text-danger'"
          >
            <span class="font-bold shrink-0" :class="item.success ? 'text-brand-700' : 'text-danger'">
              {{ item.success ? '✓' : '✗' }}
            </span>
            <span class="font-semibold shrink-0 text-ink-secondary">{{ item.key }}:</span>
            <span class="truncate text-ink-muted">{{ item.value }}</span>
          </div>
          <div v-if="progressLog.length === 0" class="text-center py-6 text-[#999] text-xs font-sans">
            Chưa có khóa nào được dịch trong phiên này...
          </div>
        </div>
      </div>

    </div>
    <template #footer>
        <button
          v-if="!progressStats.finished && !progressStats.stopped"
          type="button"
          class="mr-auto px-3.5 py-2 rounded-lg border border-[#e2c8c8] bg-white text-xs font-bold text-danger hover:bg-[#fff5f4] cursor-pointer flex items-center gap-1.5"
          @click="emit('stop')"
        >
          <i class="fa-solid fa-stop" aria-hidden="true"></i>
          <span>Dừng lại</span>
        </button>

        <button
          type="button"
          class="px-4 py-2 rounded-lg text-xs font-bold cursor-pointer"
          :class="progressStats.finished || progressStats.stopped
            ? 'bg-brand-900 hover:bg-[#153317] text-white border-0'
            : 'border border-line-strong bg-white text-ink-muted'"
          @click="emit('close')"
        >
          {{ progressStats.finished ? 'Hoàn tất & Đóng' : 'Đóng cửa sổ' }}
        </button>
    </template>
  </AdminModal>
</template>
