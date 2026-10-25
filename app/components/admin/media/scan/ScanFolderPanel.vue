<script setup lang="ts">
import type { ScanJobStatus, ScanSummary } from '~/types/media-scan'

/**
 * "Quét thư mục ảnh mồ côi" on `/admin/media/scan` — display only. The job, its state and
 * every request live in the page (`useMediaScanJob`); this renders them and emits clicks.
 */
const props = defineProps<{
  scanning: boolean
  scanJob: ScanJobStatus | null
  scanResult: ScanSummary | null
  forceResettingScan: boolean
}>()
const autoRepointToR2 = defineModel<boolean>('autoRepointToR2', { required: true })
const emit = defineEmits<{ start: [], cancel: [], forceReset: [] }>()

const scanPhaseLabel: Record<ScanJobStatus['phase'], string> = {
  scanning: 'Đang quét',
  done: 'Xong',
  failed: 'Lỗi',
  cancelled: 'Đã hủy',
}

const scanProgressPercent = computed(() => {
  if (!props.scanJob || props.scanJob.total === 0) return 0
  return Math.min(100, Math.round((props.scanJob.done / props.scanJob.total) * 100))
})

const scanStalled = computed(() => {
  if (!props.scanJob?.running) return false
  // Treo > 90s ở cùng phase mà chưa tăng `done` → coi là kẹt.
  return Date.now() - props.scanJob.startedAt > 90_000 && props.scanJob.done === 0
})
</script>

<template>
  <section class="rounded-xl border border-line bg-white p-5 flex flex-col gap-3">
    <header class="flex items-start gap-3">
      <i class="fa-solid fa-folder-tree text-2xl text-brand-700 mt-0.5" aria-hidden="true"></i>
      <div>
        <h2 class="m-0 text-base font-bold text-brand-950">Quét thư mục ảnh mồ côi</h2>
        <p class="m-0 mt-1 text-[0.82rem] text-ink-muted">Duyệt đệ quy <code class="rounded bg-surface-tint px-1.5 py-0.5 font-mono text-[0.78rem]">public/uploads/</code> và tự động nhập ảnh chưa có hàng CSDL. Hữu ích khi copy ảnh thẳng vào thư mục (SCP, rsync, backup). Tích "Tự đẩy lên R2" để upload R2 ngay khi nhập (giữ file local làm fallback).</p>
      </div>
    </header>

    <div class="flex flex-wrap items-center gap-3">
      <button
        type="button"
        class="inline-flex items-center gap-2 rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-bold text-white border-0 cursor-pointer transition-colors hover:bg-brand-900 disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="scanning"
        :aria-busy="scanning"
        @click="emit('start')"
      >
        <i class="fa-solid fa-folder-tree" :class="scanning ? 'fa-spinner animate-spin' : ''" aria-hidden="true"></i>
        {{ scanning ? 'Đang quét...' : 'Bắt đầu quét' }}
      </button>
      <label class="inline-flex items-center gap-2 text-sm font-semibold text-brand-950 cursor-pointer select-none">
        <input
          v-model="autoRepointToR2"
          type="checkbox"
          class="h-4 w-4 accent-brand-700 cursor-pointer"
          :disabled="scanning"
        />
        Tự đẩy lên R2 khi nhập
      </label>
      <button
        v-if="scanning"
        type="button"
        class="inline-flex items-center gap-2 rounded-lg border border-[#a32924] bg-white px-4 py-2.5 text-sm font-bold text-[#a32924] cursor-pointer transition-colors hover:bg-[#fdf0f0] disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="scanJob?.cancelling"
        @click="emit('cancel')"
      >
        <i class="fa-solid fa-stop" aria-hidden="true"></i>
        {{ scanJob?.cancelling ? 'Đang dừng...' : 'Hủy quét' }}
      </button>
      <button
        v-if="scanStalled"
        type="button"
        class="inline-flex items-center gap-2 rounded-lg bg-[#a32924] px-4 py-2.5 text-sm font-bold text-white border-0 cursor-pointer hover:bg-[#7a1e1c] disabled:opacity-50"
        :disabled="forceResettingScan"
        :aria-busy="forceResettingScan"
        @click="emit('forceReset')"
      >
        <i class="fa-solid" :class="forceResettingScan ? 'fa-spinner animate-spin' : 'fa-bolt'" aria-hidden="true"></i>
        {{ forceResettingScan ? 'Đang gỡ...' : 'Buộc gỡ kẹt' }}
      </button>
      <span v-if="scanning" class="text-sm text-ink-muted">Đang chạy nền. Có thể đóng trang — worker tiếp tục.</span>
    </div>

    <!-- Tiến độ job quét -->
    <div v-if="scanJob" class="rounded-lg border border-[#cce5cd] bg-surface-tint p-4 flex flex-col gap-2" role="status" :aria-busy="scanJob.running">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="text-sm font-bold text-brand-950">
          <i
            class="fa-solid mr-1.5"
            :class="{
              'fa-spinner animate-spin': scanJob.running && !scanJob.cancelling,
              'fa-check-circle text-[#2c6e33]': scanJob.phase === 'done',
              'fa-circle-xmark text-[#a32924]': scanJob.phase === 'failed',
              'fa-circle-stop text-[#8a6412]': scanJob.phase === 'cancelled',
            }"
            aria-hidden="true"
          ></i>
          {{ scanPhaseLabel[scanJob.phase] }}
          <span v-if="scanJob.cancelling" class="text-[#8a6412]">(đang dừng)</span>
        </span>
        <span class="text-xs text-ink-muted">
          {{ scanJob.done }} / {{ scanJob.total }} file
          <span v-if="scanJob.total > 0">· {{ scanProgressPercent }}%</span>
        </span>
      </div>
      <div class="h-2 w-full overflow-hidden rounded-full bg-[#d0ddd1]" role="progressbar" :aria-valuenow="scanProgressPercent" aria-valuemin="0" aria-valuemax="100">
        <div class="h-full rounded-full bg-brand-700 transition-all duration-300" :style="{ width: `${scanProgressPercent}%` }"></div>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
        <div><span class="font-bold text-brand-900">{{ scanJob.imported }}</span><span class="text-ink-muted"> đã nhập</span></div>
        <div><span class="font-bold text-ink-muted">{{ scanJob.skipped }}</span><span class="text-ink-muted"> bỏ qua</span></div>
        <div class="text-ink-muted">{{ scanJob.message }}</div>
      </div>
      <div v-if="scanJob.truncated" class="text-xs text-[#8a6412]">
        <i class="fa-solid fa-triangle-exclamation mr-1" aria-hidden="true"></i>
        Đạt giới hạn 5000 tệp — chạy lại để quét tiếp.
      </div>
      <div v-if="scanJob.errors.length > 0" class="text-xs text-[#a32924]">
        <i class="fa-solid fa-triangle-exclamation mr-1" aria-hidden="true"></i>
        {{ scanJob.errors.length }} file lỗi: {{ scanJob.errors.slice(0, 5).join(', ') }}{{ scanJob.errors.length > 5 ? '...' : '' }}
      </div>
      <div v-if="scanJob.legacyMatched > 0" class="text-xs text-ink-muted">
        <i class="fa-solid fa-circle-info mr-1" aria-hidden="true"></i>
        {{ scanJob.legacyMatched }} tệp đã được lượt quét trước nhập lên R2 — không nhập lại.
      </div>
      <div v-if="scanJob.conflicts > 0" class="text-xs text-[#8a6412] break-all">
        <i class="fa-solid fa-triangle-exclamation mr-1" aria-hidden="true"></i>
        {{ scanJob.conflicts }} tệp trùng tên với ảnh đã có trên R2 — bỏ qua, không ghi đè: {{ scanJob.conflictFiles.slice(0, 5).join(', ') }}{{ scanJob.conflicts > 5 ? '...' : '' }}
      </div>
    </div>

    <!-- Kết quả quét (giữ hiện sau khi xong) -->
    <div v-if="scanResult && !scanning" class="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-2">
      <div class="rounded-lg border border-[#cce5cd] bg-[#eef7ee] p-3">
        <p class="m-0 text-xs font-bold uppercase tracking-wide text-ink-muted">Đã nhập</p>
        <p class="m-0 mt-1 text-xl font-extrabold text-brand-900">{{ scanResult.imported }}</p>
      </div>
      <div class="rounded-lg border border-line bg-[#f8faf8] p-3">
        <p class="m-0 text-xs font-bold uppercase tracking-wide text-ink-muted">Bỏ qua</p>
        <p class="m-0 mt-1 text-xl font-extrabold text-ink-muted">{{ scanResult.skipped }}</p>
      </div>
      <div v-if="scanResult.truncated" class="rounded-lg border border-[#f0dcae] bg-[#fdf6e7] p-3">
        <p class="m-0 text-xs font-bold uppercase tracking-wide text-[#8a6412]">Cắt ngang</p>
        <p class="m-0 mt-1 text-sm font-bold text-[#8a6412]">Đạt 5000 tệp — chạy lại để quét tiếp</p>
      </div>
    </div>
    <p v-if="scanResult && scanResult.imported > 0 && !scanning" class="m-0 text-sm">
      <NuxtLink to="/admin/media" class="text-brand-700 font-semibold no-underline hover:underline">Xem thư viện →</NuxtLink>
    </p>
  </section>
</template>
