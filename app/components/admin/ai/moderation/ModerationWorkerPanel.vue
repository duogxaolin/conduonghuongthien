<script setup lang="ts">
import { formatModerationTime as formatTime, formatUptime } from '~/utils/moderation-format'
import type { ModerationWorkerStatus } from '~/types/moderation'

/**
 * Tab "Trạng thái Worker & Hệ thống" of `/admin/ai/moderation` — presentational. The
 * status, the background rescan and the restarts live in `useModerationWorker`, which the
 * page owns; this panel shows them and says which button was pressed.
 */
defineProps<{
  workerData: ModerationWorkerStatus | null
  workerLoading: boolean
  rescanBusy: boolean
  rescanProgressText: string
  rescanAiUnavailableText: string
  restartingWorker: boolean
  restartingServer: boolean
}>()

const emit = defineEmits<{
  refresh: []
  'rescan-all': []
  'restart-worker': []
  'restart-server': []
}>()
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- Worker Status Banner -->
    <div
      class="rounded-xl border p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-all"
      :class="workerData?.status === 'active'
        ? 'border-[#8ed694] bg-[#f0f7f1]'
        : 'border-[#f1b8b5] bg-[#fff4f3]'"
    >
      <div class="flex items-center gap-3">
        <span
          class="w-10 h-10 rounded-full flex items-center justify-center text-white text-base shadow-xs"
          :class="workerData?.status === 'active' ? 'bg-brand-700' : 'bg-danger'"
        >
          <i :class="workerData?.status === 'active' ? 'fa-solid fa-shield-check' : 'fa-solid fa-triangle-exclamation'"></i>
        </span>
        <div>
          <div class="flex items-center gap-2">
            <h2 class="m-0 text-base font-extrabold text-brand-950">Moderation Worker: {{ workerData?.status === 'active' ? 'Đang hoạt động bình thường' : 'Có lỗi phát sinh' }}</h2>
            <span
              class="px-2 py-0.5 rounded-full text-[0.68rem] font-bold uppercase tracking-wider"
              :class="workerData?.status === 'active' ? 'bg-brand-700 text-white' : 'bg-danger text-white'"
            >
              {{ workerData?.status === 'active' ? 'HEALTHY' : 'DEGRADED' }}
            </span>
          </div>
          <p class="m-0 mt-0.5 text-xs text-ink-muted">
            Thời gian hoạt động liên tục: <strong class="text-brand-950">{{ formatUptime(workerData?.uptimeSeconds || 0) }}</strong>
            • Khởi động lúc: {{ formatTime(workerData?.startedAt || null) }}
          </p>
        </div>
      </div>

      <button
        type="button"
        class="px-3 py-1.5 rounded-lg border border-line-strong bg-white text-xs font-bold text-brand-900 hover:bg-surface-tint transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs"
        :disabled="workerLoading"
        @click="emit('refresh')"
      >
        <i class="fa-solid fa-rotate text-xs" :class="workerLoading ? 'animate-spin' : ''"></i>
        <span>Cập nhật số liệu</span>
      </button>
    </div>

    <!-- Metrics Grid -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <div class="rounded-xl border border-line bg-white p-4 flex flex-col gap-1 shadow-xs">
        <span class="text-xs font-semibold text-ink-muted">Tổng lượt quét an ninh</span>
        <span class="text-2xl font-extrabold text-brand-950">{{ workerData?.totalScanned ?? 0 }}</span>
        <span class="text-[0.7rem] text-brand-700 font-medium">Bình luận, chat, livestream</span>
      </div>

      <div class="rounded-xl border border-line bg-white p-4 flex flex-col gap-1 shadow-xs">
        <span class="text-xs font-semibold text-ink-muted">Chặn tức thì (0ms)</span>
        <span class="text-2xl font-extrabold text-danger">{{ workerData?.blockedInstant ?? 0 }}</span>
        <span class="text-[0.7rem] text-ink-muted">Từ khóa thô tục, chống phá</span>
      </div>

      <div class="rounded-xl border border-line bg-white p-4 flex flex-col gap-1 shadow-xs">
        <span class="text-xs font-semibold text-ink-muted">Chặn bởi AI ngữ cảnh</span>
        <span class="text-2xl font-extrabold text-[#b78103]">{{ workerData?.blockedAi ?? 0 }}</span>
        <span class="text-[0.7rem] text-ink-muted">Độ trễ AI: ~{{ workerData?.lastAiLatencyMs ?? 0 }}ms</span>
      </div>

      <div class="rounded-xl border border-line bg-white p-4 flex flex-col gap-1 shadow-xs">
        <span class="text-xs font-semibold text-ink-muted">Nội dung an toàn</span>
        <span class="text-2xl font-extrabold text-brand-700">{{ workerData?.allowedCount ?? 0 }}</span>
        <span class="text-[0.7rem] text-ink-muted">Cho phép hiển thị công khai</span>
      </div>
    </div>

    <!-- System Resources & Diagnostics -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div class="rounded-xl border border-line bg-white p-5 flex flex-col gap-3 shadow-xs">
        <h3 class="m-0 text-sm font-extrabold text-brand-950 flex items-center gap-2">
          <i class="fa-solid fa-microchip text-brand-700"></i>
          Bộ nhớ & Hạ tầng Worker
        </h3>
        <div class="flex flex-col gap-2 text-xs">
          <div class="flex flex-col gap-1.5 py-1 border-b border-line">
            <div class="flex items-center justify-between">
              <span class="text-ink-muted">Bộ nhớ RAM Heap (Đang dùng / Giới hạn thật):</span>
              <span class="font-bold text-brand-950">{{ workerData?.memoryUsageMb?.heapUsed ?? 0 }} MB / {{ workerData?.memoryUsageMb?.heapLimit ? workerData.memoryUsageMb.heapLimit + ' MB' : '—' }}</span>
            </div>
            <div class="h-1.5 w-full rounded-full bg-line overflow-hidden" role="progressbar" :aria-valuenow="workerData?.memoryUsageMb?.heapUsedPercent ?? 0" aria-valuemin="0" aria-valuemax="100">
              <div
                class="h-full rounded-full transition-all"
                :class="(workerData?.memoryUsageMb?.heapUsedPercent ?? 0) >= 85 ? 'bg-[#d12420]' : (workerData?.memoryUsageMb?.heapUsedPercent ?? 0) >= 60 ? 'bg-[#e0a800]' : 'bg-[#2c6e33]'"
                :style="{ width: `${Math.min(100, Math.max(0, workerData?.memoryUsageMb?.heapUsedPercent ?? 0))}%` }"
              ></div>
            </div>
            <span class="text-[0.66rem] text-ink-faint">Đang dùng {{ workerData?.memoryUsageMb?.heapUsedPercent ?? 0 }}% giới hạn V8 (heap ceil do <code class="text-[0.64rem]">--max-old-space-size</code>).</span>
          </div>
          <div class="flex items-center justify-between py-1 border-b border-line">
            <span class="text-ink-muted">Cấp phát Heap V8 (tự kéo theo nhu cầu):</span>
            <span class="font-medium text-ink-muted">{{ workerData?.memoryUsageMb?.heapTotal ?? 0 }} MB</span>
          </div>
          <div class="flex items-center justify-between py-1 border-b border-line">
            <span class="text-ink-muted">Bộ nhớ RAM tiến trình (RSS):</span>
            <span class="font-bold text-brand-950">{{ workerData?.memoryUsageMb?.rss ?? 0 }} MB</span>
          </div>
          <div class="flex items-center justify-between py-1 border-b border-line">
            <span class="text-ink-muted">Mô hình AI kiểm duyệt:</span>
            <span class="font-bold text-brand-700">{{ workerData?.aiProvider }} / {{ workerData?.aiModel }} ({{ workerData?.aiServiceActive ? 'Đang hoạt động' : 'Tắt' }})</span>
          </div>
          <div class="flex items-center justify-between py-1">
            <span class="text-ink-muted">Quy tắc trong bộ nhớ đệm:</span>
            <span class="font-bold text-brand-950">{{ workerData?.cachedRulesCount ?? 0 }} quy tắc</span>
          </div>
        </div>
      </div>

      <div class="rounded-xl border border-line bg-white p-5 flex flex-col gap-3 shadow-xs">
        <h3 class="m-0 text-sm font-extrabold text-brand-950 flex items-center gap-2">
          <i class="fa-solid fa-heart-pulse text-danger"></i>
          Nhật ký chẩn đoán & Sức khỏe
        </h3>
        <div class="flex flex-col gap-2 text-xs">
          <div class="flex items-center justify-between py-1 border-b border-line">
            <span class="text-ink-muted">Số lỗi kiểm duyệt phát sinh:</span>
            <span class="font-bold" :class="workerData?.errorCount ? 'text-danger' : 'text-brand-700'">{{ workerData?.errorCount ?? 0 }} lần</span>
          </div>
          <div class="flex items-center justify-between py-1 border-b border-line">
            <span class="text-ink-muted">Lần quét gần nhất:</span>
            <span class="font-bold text-brand-950">{{ formatTime(workerData?.lastScannedAt || null) }}</span>
          </div>
          <div class="flex items-center justify-between py-1">
            <span class="text-ink-muted">Lỗi gần nhất:</span>
            <span class="font-medium text-ink-muted truncate max-w-[240px]">{{ workerData?.lastError || 'Không có lỗi' }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Emergency Actions Card -->
    <div class="rounded-xl border border-line bg-white p-5 flex flex-col gap-4 shadow-xs">
      <div>
        <h3 class="m-0 text-sm font-extrabold text-brand-950 flex items-center gap-2">
          <i class="fa-solid fa-wrench text-brand-700"></i>
          Thao tác Khẩn cấp & Khởi động lại
        </h3>
        <p class="m-0 mt-1 text-xs text-ink-muted">Các công cụ quản trị giúp phục hồi hệ thống khi phát hiện lỗi hoặc dọn dẹp nội dung xấu độc còn sót.</p>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <!-- Rescan All -->
        <div class="rounded-lg border border-line-strong bg-surface p-4 flex flex-col justify-between gap-3">
          <div>
            <h4 class="m-0 text-xs font-bold text-brand-900 flex items-center gap-1.5">
              <i class="fa-solid fa-broom"></i> Quét & Dọn sạch nội dung cũ
            </h4>
            <p class="m-0 mt-1 text-[0.72rem] text-ink-muted">
              Rà soát lại toàn bộ bình luận bài viết, video và tin chat trực tiếp trong CSDL. Tự động ẩn hoặc xóa mọi nội dung vi phạm.
            </p>
          </div>
          <button
            type="button"
            class="w-full px-3 py-2 rounded-lg bg-brand-900 hover:bg-[#153317] text-white text-xs font-bold cursor-pointer transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 border-none"
            :disabled="rescanBusy"
            @click="emit('rescan-all')"
          >
            <i class="fa-solid fa-play text-xs" :class="rescanBusy ? 'animate-spin motion-reduce:animate-none' : ''" aria-hidden="true"></i>
            <span>{{ rescanBusy ? 'Đang quét...' : 'Quét & Dọn ngay' }}</span>
          </button>
          <p
            v-if="rescanProgressText"
            class="m-0 text-[0.72rem] text-ink-muted"
            role="status"
            aria-live="polite"
          >
            {{ rescanProgressText }}
          </p>
          <!-- Lượt quét vừa xong KHÔNG có AI (chưa cấu hình) → chỉ quét bằng luật. -->
          <p
            v-if="rescanAiUnavailableText"
            class="m-0 rounded-lg border border-[#f3d48a] bg-[#fff8e6] px-2.5 py-1.5 text-[0.72rem] font-semibold text-[#7a4f00] flex items-start gap-1.5"
            role="status"
          >
            <i class="fa-solid fa-triangle-exclamation mt-0.5" aria-hidden="true"></i>
            <span>{{ rescanAiUnavailableText }}</span>
          </p>
        </div>

        <!-- Restart Worker -->
        <div class="rounded-lg border border-line bg-surface p-4 flex flex-col justify-between gap-3">
          <div>
            <h4 class="m-0 text-xs font-bold text-brand-950 flex items-center gap-1.5">
              <i class="fa-solid fa-arrows-rotate"></i> Khởi động lại Worker
            </h4>
            <p class="m-0 mt-1 text-[0.72rem] text-ink-muted">
              Làm mới bộ đệm quy tắc trong RAM, đặt lại bộ đếm lỗi và kết nối lại AI Gateway mà không làm gián đoạn website.
            </p>
          </div>
          <button
            type="button"
            class="w-full px-3 py-2 rounded-lg border border-brand-700 bg-white text-brand-700 hover:bg-surface-tint text-xs font-bold cursor-pointer transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
            :disabled="restartingWorker"
            @click="emit('restart-worker')"
          >
            <i class="fa-solid fa-rotate text-xs" :class="restartingWorker ? 'animate-spin' : ''"></i>
            <span>{{ restartingWorker ? 'Đang khởi động...' : 'Khởi động lại Worker' }}</span>
          </button>
        </div>

        <!-- Restart Server Process -->
        <div class="rounded-lg border border-[#f1b8b5] bg-[#fff5f4] p-4 flex flex-col justify-between gap-3">
          <div>
            <h4 class="m-0 text-xs font-bold text-danger flex items-center gap-1.5">
              <i class="fa-solid fa-power-off"></i> Khởi động lại Website
            </h4>
            <p class="m-0 mt-1 text-[0.72rem] text-[#8c231f]">
              Khởi động lại toàn bộ tiến trình máy chủ website (process exit / supervisor restart). Website gián đoạn 3-5 giây.
            </p>
          </div>
          <button
            type="button"
            class="w-full px-3 py-2 rounded-lg bg-danger hover:bg-[#a81c19] text-white text-xs font-bold cursor-pointer transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 border-none"
            :disabled="restartingServer"
            @click="emit('restart-server')"
          >
            <i class="fa-solid fa-power-off text-xs" :class="restartingServer ? 'animate-spin' : ''"></i>
            <span>{{ restartingServer ? 'Đang khởi động lại...' : 'Khởi động lại Website' }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
