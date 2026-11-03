<script setup lang="ts">
import type { SelfHealReport } from '~/types/media-scan'

/**
 * "Check chéo local ↔ R2 + tự vá" on `/admin/media/scan` — display only. The request, the
 * confirm and the state live in the page; this renders them and emits the clicks
 * (`run(true)` = "Xem trước", `run(false)` = "Chạy sửa").
 */
defineProps<{
  selfHealing: boolean
  selfHealPreviewing: boolean
  selfHealReport: SelfHealReport | null
}>()
const emit = defineEmits<{ run: [dryRun: boolean] }>()
</script>

<template>
  <section class="rounded-xl border border-line bg-white p-5 flex flex-col gap-3">
    <header class="flex items-start gap-3">
      <i class="fa-solid fa-stethoscope text-2xl text-brand-700 mt-0.5" aria-hidden="true"></i>
      <div>
        <h2 class="m-0 text-base font-bold text-brand-950">Check chéo local ↔ R2 + tự vá</h2>
        <p class="m-0 mt-1 text-[0.82rem] text-ink-muted">Kiểm tra từng hàng <code class="font-mono">media</code> (provider=<code class="font-mono">r2</code>) bằng HeadObject: nếu R2 object thực sự không tồn tại → upload lại từ file local gốc. Sau đó repoint <code class="font-mono">articles.thumbnail_url</code> <code class="font-mono">/uploads/migrated/...</code> sang R2 URL khớp. Bấm <strong>"Xem trước"</strong> để xem số lượng không đổi gì, <strong>"Chạy sửa"</strong> để thực sự vá. Idempotent — bấm lại an toàn.</p>
      </div>
    </header>

    <div class="flex flex-wrap items-center gap-3">
      <button
        type="button"
        class="inline-flex items-center gap-2 rounded-lg border border-line-strong bg-white px-4 py-2.5 text-sm font-bold text-brand-700 cursor-pointer transition-colors hover:bg-surface-tint disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="selfHealPreviewing || selfHealing"
        :aria-busy="selfHealPreviewing"
        @click="emit('run', true)"
      >
        <i class="fa-solid fa-eye" :class="selfHealPreviewing ? 'fa-spinner animate-spin' : ''" aria-hidden="true"></i>
        {{ selfHealPreviewing ? 'Đang xem trước...' : 'Xem trước' }}
      </button>
      <button
        type="button"
        class="inline-flex items-center gap-2 rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-bold text-white border-0 cursor-pointer transition-colors hover:bg-brand-900 disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="selfHealPreviewing || selfHealing"
        :aria-busy="selfHealing"
        @click="emit('run', false)"
      >
        <i class="fa-solid fa-wand-magic-sparkles" :class="selfHealing ? 'fa-spinner animate-spin' : ''" aria-hidden="true"></i>
        {{ selfHealing ? 'Đang vá...' : 'Chạy sửa' }}
      </button>
    </div>

    <p v-if="selfHealPreviewing || selfHealing" class="m-0 text-sm text-ink-muted">
      {{ selfHealPreviewing ? 'Đang HeadObject từng ảnh R2...' : 'Đang upload lại + repoint...' }}
    </p>

    <!-- Báo cáo self-heal (xem trước hoặc kết quả) -->
    <div v-if="selfHealReport" class="rounded-lg border border-[#cce5cd] bg-surface-tint p-4 flex flex-col gap-3" role="status">
      <div class="text-sm font-bold text-brand-950">
        <i class="fa-solid mr-1.5" :class="selfHealReport.r2Missing === 0 ? 'fa-circle-check text-brand-700' : 'fa-circle-info text-warn-ink'" aria-hidden="true"></i>
        Đã kiểm tra {{ selfHealReport.r2Checked }} ảnh R2
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div class="rounded-lg border border-[#cce5cd] bg-white p-2.5">
          <p class="m-0 text-[0.7rem] font-bold uppercase tracking-wide text-ink-muted">R2 OK</p>
          <p class="m-0 mt-0.5 text-lg font-extrabold text-brand-900">{{ selfHealReport.r2Ok }}</p>
        </div>
        <div class="rounded-lg border border-[#f0dcae] bg-[#fdf6e7] p-2.5">
          <p class="m-0 text-[0.7rem] font-bold uppercase tracking-wide text-warn-ink">R2 thiếu</p>
          <p class="m-0 mt-0.5 text-lg font-extrabold text-warn-ink">{{ selfHealReport.r2Missing }}</p>
        </div>
        <div class="rounded-lg border border-[#cce5cd] bg-surface-tint p-2.5">
          <p class="m-0 text-[0.7rem] font-bold uppercase tracking-wide text-ink-muted">Đã upload lại</p>
          <p class="m-0 mt-0.5 text-lg font-extrabold text-brand-900">{{ selfHealReport.r2Reuploaded }}</p>
        </div>
        <div class="rounded-lg border border-[#a32924] bg-danger-bg p-2.5">
          <p class="m-0 text-[0.7rem] font-bold uppercase tracking-wide text-[#a32924]">Mất gốc</p>
          <p class="m-0 mt-0.5 text-lg font-extrabold text-[#a32924]">{{ selfHealReport.r2Lost }}</p>
        </div>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        <div class="rounded-lg border border-[#cce5cd] bg-white p-2.5">
          <p class="m-0 text-[0.7rem] font-bold uppercase tracking-wide text-ink-muted">Thumbnail bài viết repoint</p>
          <p class="m-0 mt-0.5 text-lg font-extrabold text-brand-900">{{ selfHealReport.thumbnailsRepointed }}</p>
        </div>
        <div class="rounded-lg border border-[#cfe8d0] bg-surface-tint p-2.5">
          <p class="m-0 text-[0.7rem] font-bold uppercase tracking-wide text-brand-900">Thumbnail đổi sang ảnh mặc định</p>
          <p class="m-0 mt-0.5 text-lg font-extrabold text-brand-900">{{ selfHealReport.thumbnailsDefaulted }}</p>
        </div>
      </div>
      <div v-if="selfHealReport.backupStamp" class="text-xs">
        <div class="rounded-lg border border-[#f0dcae] bg-white p-2.5 inline-block">
          <p class="m-0 text-[0.7rem] font-bold uppercase tracking-wide text-warn-ink">Snapshot</p>
          <p class="m-0 mt-0.5 text-sm font-bold text-warn-ink break-all">{{ selfHealReport.backupStamp }}</p>
        </div>
      </div>
      <div v-if="selfHealReport.missingSamples.length > 0" class="text-xs text-warn-ink">
        <i class="fa-solid fa-triangle-exclamation mr-1" aria-hidden="true"></i>
        Mẫu thiếu ({{ selfHealReport.missingSamples.length }}): {{ selfHealReport.missingSamples.slice(0, 8).join(', ') }}{{ selfHealReport.missingSamples.length > 8 ? '...' : '' }}
      </div>
      <div v-if="selfHealReport.r2Lost > 0" class="text-xs text-brand-700" role="status">
        <i class="fa-solid fa-circle-check mr-1" aria-hidden="true"></i>
        {{ selfHealReport.r2Lost }} ảnh R2 thiếu object VÀ file local cũng không còn. Đã đổi <strong>{{ selfHealReport.thumbnailsDefaulted }}</strong> thumbnail bài viết + <strong>{{ selfHealReport.mediaUrlsDefaulted }}</strong> URL media sang ảnh mặc định — IPX không còn fetch R2 404. Nếu có file gốc, upload qua /admin/settings/backup (tar.gz) hoặc copy vào public/uploads/ rồi chạy lại (URL sẽ khôi phục).
      </div>
    </div>
  </section>
</template>
