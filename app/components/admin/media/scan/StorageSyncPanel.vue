<script setup lang="ts">
import type { MediaCounts, SyncDirection, SyncJobStatus, SyncSummary } from '~/types/media-scan'

/**
 * "Đồng bộ storage ảnh" (local ↔ R2) on `/admin/media/scan` — display only. The job, its
 * state and every request live in the page (`useMediaSyncJob`); this renders them and
 * emits clicks.
 */
const props = defineProps<{
  counts: MediaCounts
  syncing: boolean
  syncDirection: SyncDirection | ''
  jobStatus: SyncJobStatus | null
  syncResult: SyncSummary | null
  forceResettingSync: boolean
}>()
const emit = defineEmits<{ sync: [direction: SyncDirection], cancel: [], forceReset: [] }>()

const phaseLabel: Record<SyncJobStatus['phase'], string> = {
  backup: 'Đang backup trước sync',
  sync: 'Đang sync',
  rewrite: 'Đang thay URL bài viết',
  done: 'Xong',
  failed: 'Lỗi',
  cancelled: 'Đã hủy',
}

const progressPercent = computed(() => {
  if (!props.jobStatus || props.jobStatus.total === 0) return 0
  return Math.min(100, Math.round((props.jobStatus.done / props.jobStatus.total) * 100))
})

const syncStalled = computed(() => {
  if (!props.jobStatus?.running) return false
  return Date.now() - props.jobStatus.startedAt > 90_000 && props.jobStatus.done === 0
})
</script>

<template>
  <section class="rounded-xl border border-line bg-white p-5 flex flex-col gap-3">
    <header class="flex items-start gap-3">
      <i class="fa-solid fa-cloud-arrow-up text-2xl text-brand-700 mt-0.5" aria-hidden="true"></i>
      <div>
        <h2 class="m-0 text-base font-bold text-brand-950">Đồng bộ storage ảnh</h2>
        <p class="m-0 mt-1 text-[0.82rem] text-ink-muted">Chuyển toàn bộ ảnh sang storage bên kia — tải sang, xoá bản cũ, cập nhật URL trong CSDL + bài viết. Chỉ ảnh (bảng <code class="font-mono">media</code>).</p>
      </div>
    </header>

    <!-- Số lượng hiện tại -->
    <div class="grid grid-cols-2 gap-3">
      <div class="rounded-lg border border-line bg-[#f8faf8] p-3 text-center">
        <p class="m-0 text-xs font-bold uppercase tracking-wide text-ink-muted">Local</p>
        <p class="m-0 mt-1 text-xl font-extrabold text-brand-950">{{ counts.local }}</p>
      </div>
      <div class="rounded-lg border border-line bg-[#f8faf8] p-3 text-center">
        <p class="m-0 text-xs font-bold uppercase tracking-wide text-ink-muted">R2</p>
        <p class="m-0 mt-1 text-xl font-extrabold text-brand-950">{{ counts.r2 }}</p>
      </div>
    </div>

    <!-- Cảnh báo -->
    <div class="rounded-lg border border-[#f0dcae] bg-[#fdf6e7] px-3.5 py-2.5 text-[0.82rem] text-[#8a6412]" role="status">
      <i class="fa-solid fa-triangle-exclamation mt-0.5 mr-1.5" aria-hidden="true"></i>
      <span>Ảnh đã nhúng trong bài viết sẽ được tự thay URL sang storage mới. Trước khi sync, hệ thống tự backup (SQL + file) để recover thủ công nếu lỗi — không auto rollback (restore toàn DB mất dữ liệu unrelated). Để hoàn tác, chạy sync ngược.</span>
    </div>

    <!-- Nút đồng bộ -->
    <div class="flex flex-wrap gap-3">
      <button
        type="button"
        class="inline-flex items-center gap-2 rounded-lg border border-line-strong bg-white px-4 py-2.5 text-sm font-bold text-brand-700 cursor-pointer transition-colors hover:bg-surface-tint disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="syncing || counts.local === 0"
        :aria-busy="syncing && syncDirection === 'to-r2'"
        @click="emit('sync', 'to-r2')"
      >
        <i class="fa-solid fa-cloud-arrow-up" :class="syncing && syncDirection === 'to-r2' ? 'fa-spinner animate-spin' : ''" aria-hidden="true"></i>
        {{ syncing && syncDirection === 'to-r2' ? 'Đang chuyển lên R2...' : 'Đồng bộ lên R2' }}
      </button>
      <button
        type="button"
        class="inline-flex items-center gap-2 rounded-lg border border-line-strong bg-white px-4 py-2.5 text-sm font-bold text-brand-700 cursor-pointer transition-colors hover:bg-surface-tint disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="syncing || counts.r2 === 0"
        :aria-busy="syncing && syncDirection === 'to-local'"
        @click="emit('sync', 'to-local')"
      >
        <i class="fa-solid fa-cloud-arrow-down" :class="syncing && syncDirection === 'to-local' ? 'fa-spinner animate-spin' : ''" aria-hidden="true"></i>
        {{ syncing && syncDirection === 'to-local' ? 'Đang chuyển về local...' : 'Đồng bộ về local' }}
      </button>
      <button
        v-if="syncing"
        type="button"
        class="inline-flex items-center gap-2 rounded-lg border border-[#a32924] bg-white px-4 py-2.5 text-sm font-bold text-[#a32924] cursor-pointer transition-colors hover:bg-[#fdf0f0] disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="jobStatus?.cancelling"
        @click="emit('cancel')"
      >
        <i class="fa-solid fa-stop" aria-hidden="true"></i>
        {{ jobStatus?.cancelling ? 'Đang dừng...' : 'Hủy sync' }}
      </button>
      <button
        v-if="syncStalled"
        type="button"
        class="inline-flex items-center gap-2 rounded-lg bg-[#a32924] px-4 py-2.5 text-sm font-bold text-white border-0 cursor-pointer hover:bg-[#7a1e1c] disabled:opacity-50"
        :disabled="forceResettingSync"
        :aria-busy="forceResettingSync"
        @click="emit('forceReset')"
      >
        <i class="fa-solid" :class="forceResettingSync ? 'fa-spinner animate-spin' : 'fa-bolt'" aria-hidden="true"></i>
        {{ forceResettingSync ? 'Đang gỡ...' : 'Buộc gỡ kẹt' }}
      </button>
    </div>
    <p v-if="syncing" class="m-0 text-sm text-ink-muted">
      Đang chạy nền. Có thể đóng trang — worker tiếp tục. Mở lại sẽ thấy tiến độ.
      <span v-if="syncStalled" class="font-bold text-[#a32924]"> — Treo quá 90s ở backup, bấm "Buộc gỡ kẹt" để chạy lại ngay (không cần restart server).</span>
    </p>

    <!-- Tiến độ job nền -->
    <div v-if="jobStatus" class="rounded-lg border border-[#cce5cd] bg-surface-tint p-4 flex flex-col gap-2" role="status" :aria-busy="jobStatus.running">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="text-sm font-bold text-brand-950">
          <i
            class="fa-solid mr-1.5"
            :class="{
              'fa-spinner animate-spin': jobStatus.running && !jobStatus.cancelling,
              'fa-check-circle text-[#2c6e33]': jobStatus.phase === 'done',
              'fa-circle-xmark text-[#a32924]': jobStatus.phase === 'failed',
              'fa-circle-stop text-[#8a6412]': jobStatus.phase === 'cancelled',
            }"
            aria-hidden="true"
          ></i>
          {{ phaseLabel[jobStatus.phase] }}
          <span v-if="jobStatus.cancelling" class="text-[#8a6412]">(đang dừng)</span>
        </span>
        <span class="text-xs text-ink-muted">
          {{ jobStatus.done }} / {{ jobStatus.total }} file
          <span v-if="jobStatus.total > 0">· {{ progressPercent }}%</span>
        </span>
      </div>

      <!-- Progress bar -->
      <div class="h-2 w-full overflow-hidden rounded-full bg-[#d0ddd1]" role="progressbar" :aria-valuenow="progressPercent" aria-valuemin="0" aria-valuemax="100">
        <div class="h-full rounded-full bg-brand-700 transition-all duration-300" :style="{ width: `${progressPercent}%` }"></div>
      </div>

      <!-- Chi tiết -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div>
          <span class="font-bold text-brand-900">{{ jobStatus.synced }}</span>
          <span class="text-ink-muted"> đã chuyển</span>
        </div>
        <div>
          <span class="font-bold text-ink-muted">{{ jobStatus.skipped }}</span>
          <span class="text-ink-muted"> bỏ qua</span>
        </div>
        <div>
          <span class="font-bold text-brand-900">{{ jobStatus.articlesRewritten }}</span>
          <span class="text-ink-muted"> bài sửa URL</span>
        </div>
        <div class="text-ink-muted">
          {{ jobStatus.message }}
        </div>
      </div>

      <!-- Snapshot backup -->
      <div v-if="jobStatus.preBackupStamp" class="text-xs text-[#8a6412]">
        <i class="fa-solid fa-shield-halved mr-1" aria-hidden="true"></i>
        Snapshot trước sync: <code class="font-mono">{{ jobStatus.preBackupStamp }}</code> (giữ để recover thủ công)
      </div>

      <!-- Lỗi -->
      <div v-if="jobStatus.errors.length > 0" class="text-xs text-[#a32924]">
        <i class="fa-solid fa-triangle-exclamation mr-1" aria-hidden="true"></i>
        {{ jobStatus.errors.length }} file lỗi: {{ jobStatus.errors.slice(0, 5).join(', ') }}{{ jobStatus.errors.length > 5 ? '...' : '' }}
      </div>
    </div>

    <!-- Kết quả sync (giữ hiện sau khi xong) -->
    <div v-if="syncResult && !syncing" class="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-2">
      <div class="rounded-lg border border-[#cce5cd] bg-[#eef7ee] p-3">
        <p class="m-0 text-xs font-bold uppercase tracking-wide text-ink-muted">Đã chuyển</p>
        <p class="m-0 mt-1 text-xl font-extrabold text-brand-900">{{ syncResult.synced }}</p>
      </div>
      <div class="rounded-lg border border-line bg-[#f8faf8] p-3">
        <p class="m-0 text-xs font-bold uppercase tracking-wide text-ink-muted">Bỏ qua</p>
        <p class="m-0 mt-1 text-xl font-extrabold text-ink-muted">{{ syncResult.skipped }}</p>
      </div>
      <div class="rounded-lg border border-[#cce5cd] bg-[#eef7ee] p-3">
        <p class="m-0 text-xs font-bold uppercase tracking-wide text-ink-muted">Bài viết sửa URL</p>
        <p class="m-0 mt-1 text-xl font-extrabold text-brand-900">{{ syncResult.articlesRewritten }}</p>
      </div>
    </div>
  </section>
</template>
