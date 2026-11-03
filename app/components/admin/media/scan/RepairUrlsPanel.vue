<script setup lang="ts">
import type { RepairSummary } from '~/types/media-scan'

/**
 * "Vá URL ảnh hỏng hàng loạt" on `/admin/media/scan` — display only. The request, the
 * confirm and the state live in the page; this renders them and emits the click.
 */
defineProps<{
  repairing: boolean
  repairResult: RepairSummary | null
}>()
const emit = defineEmits<{ repair: [] }>()
</script>

<template>
  <section class="rounded-xl border border-[#f0dcae] bg-[#fdf6e7] p-5 flex flex-col gap-3">
    <header class="flex items-start gap-3">
      <i class="fa-solid fa-screwdriver-wrench text-2xl text-warn-ink mt-0.5" aria-hidden="true"></i>
      <div>
        <h2 class="m-0 text-base font-bold text-brand-950">Vá URL ảnh hỏng hàng loạt</h2>
        <p class="m-0 mt-1 text-[0.82rem] text-ink-muted">Sync trước treo ở backup nên <strong>all bài</strong> vẫn <code class="font-mono">http://localhost:3000/uploads/migrated/YYYY/MM/*.jpeg</code> trong khi file local đã bị xoá (Local 0 / R2 3212). Kèm <code class="font-mono">media.url</code> thiếu scheme → grid thành <code class="font-mono">http://localhost:3000/cdn1...</code>. Nút này vá cả <code class="font-mono">media.url</code> + <code class="font-mono">articles.content</code> + <code class="font-mono">articles.thumbnail_url</code> trong 1 transaction, tự backup SQL trước. Bấm lại an toàn.</p>
      </div>
    </header>
    <button
      type="button"
      class="inline-flex w-fit items-center gap-2 rounded-lg bg-warn-ink px-4 py-2.5 text-sm font-bold text-white border-0 cursor-pointer transition-colors hover:bg-[#6b4d0e] disabled:cursor-not-allowed disabled:opacity-50"
      :disabled="repairing"
      :aria-busy="repairing"
      @click="emit('repair')"
    >
      <i class="fa-solid" :class="repairing ? 'fa-spinner animate-spin' : 'fa-wand-magic-sparkles'" aria-hidden="true"></i>
      {{ repairing ? 'Đang vá...' : 'Vá URL all bài viết' }}
    </button>
    <p v-if="repairing" class="m-0 text-sm text-ink-muted">Đang backup SQL + UPDATE... (&lt; vài giây)</p>
    <div v-if="repairResult" class="grid grid-cols-2 sm:grid-cols-3 gap-3">
      <div class="rounded-lg border border-[#cce5cd] bg-surface-tint p-3">
        <p class="m-0 text-xs font-bold uppercase tracking-wide text-ink-muted">Media vá</p>
        <p class="m-0 mt-1 text-xl font-extrabold text-brand-900">{{ repairResult.mediaFixed }}</p>
      </div>
      <div class="rounded-lg border border-[#cce5cd] bg-surface-tint p-3">
        <p class="m-0 text-xs font-bold uppercase tracking-wide text-ink-muted">Bài viết vá</p>
        <p class="m-0 mt-1 text-xl font-extrabold text-brand-900">{{ repairResult.articlesFixed }}</p>
      </div>
      <div class="rounded-lg border border-[#cce5cd] bg-surface-tint p-3">
        <p class="m-0 text-xs font-bold uppercase tracking-wide text-ink-muted">Thumbnail vá</p>
        <p class="m-0 mt-1 text-xl font-extrabold text-brand-900">{{ repairResult.thumbnailsFixed }}</p>
      </div>
      <div v-if="repairResult.backupStamp" class="rounded-lg border border-[#f0dcae] bg-white p-3">
        <p class="m-0 text-xs font-bold uppercase tracking-wide text-warn-ink">Snapshot</p>
        <p class="m-0 mt-1 text-sm font-bold text-warn-ink break-all">{{ repairResult.backupStamp }}</p>
      </div>
    </div>
  </section>
</template>
