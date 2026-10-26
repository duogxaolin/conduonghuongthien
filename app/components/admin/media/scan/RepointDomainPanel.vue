<script setup lang="ts">
import type { RepointSummary } from '~/types/media-scan'

/**
 * "Đổi domain URL R2" on `/admin/media/scan` — display only. The two domains are the
 * page's (`v-model`); the checks, the confirm and the request live in the page.
 */
defineProps<{
  repointing: boolean
  repointResult: RepointSummary | null
}>()
const oldDomain = defineModel<string>('oldDomain', { required: true })
const newDomain = defineModel<string>('newDomain', { required: true })
const emit = defineEmits<{ repoint: [] }>()
</script>

<template>
  <section class="rounded-xl border border-line bg-white p-5 flex flex-col gap-3">
    <header class="flex items-start gap-3">
      <i class="fa-solid fa-arrow-right-arrow-left text-2xl text-brand-700 mt-0.5" aria-hidden="true"></i>
      <div>
        <h2 class="m-0 text-base font-bold text-brand-950">Đổi domain URL R2</h2>
        <p class="m-0 mt-1 text-[0.82rem] text-ink-muted">Đổi domain CDN R2 (cùng account + bucket) — tự cập nhật URL ảnh trong thư viện và mọi nội dung đang nhúng ảnh (bài viết, trang, cài đặt, chatbot…). Chỉ đổi đúng domain đã nhập, không đụng domain trông giống. File không tải lại (đã ở R2). Sao lưu CSDL trước là bắt buộc.</p>
      </div>
    </header>

    <div class="flex flex-col gap-3 rounded-lg border border-[#cce5cd] bg-surface-tint p-3">
      <div class="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label class="flex flex-col gap-1 text-sm font-bold text-brand-950 flex-1">
          Domain cũ
          <input
            v-model="oldDomain"
            type="text"
            placeholder="cdn.domaincu.com"
            class="rounded-lg border border-line-strong bg-white px-3 py-2 text-sm font-normal text-brand-950 focus:border-brand-700 focus:outline-none"
            :disabled="repointing"
          />
        </label>
        <div class="hidden sm:flex sm:items-center sm:pb-2">
          <i class="fa-solid fa-arrow-right text-ink-muted" aria-hidden="true"></i>
        </div>
        <label class="flex flex-col gap-1 text-sm font-bold text-brand-950 flex-1">
          Domain mới
          <input
            v-model="newDomain"
            type="text"
            placeholder="media.domainmoi.com"
            class="rounded-lg border border-line-strong bg-white px-3 py-2 text-sm font-normal text-brand-950 focus:border-brand-700 focus:outline-none"
            :disabled="repointing"
          />
        </label>
      </div>

      <button
        type="button"
        class="inline-flex w-fit items-center gap-2 rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-bold text-white border-0 cursor-pointer transition-colors hover:bg-brand-900 disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="repointing || !oldDomain.trim() || !newDomain.trim()"
        :aria-busy="repointing"
        @click="emit('repoint')"
      >
        <i class="fa-solid fa-arrow-right-arrow-left" :class="repointing ? 'fa-spinner animate-spin' : ''" aria-hidden="true"></i>
        {{ repointing ? 'Đang đổi...' : 'Đổi URL R2' }}
      </button>

      <p v-if="repointing" class="m-0 text-sm text-ink-muted">Đang sao lưu CSDL rồi đổi URL...</p>

      <div v-if="repointResult" class="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-2">
        <div class="rounded-lg border border-[#cce5cd] bg-[#eef7ee] p-3">
          <p class="m-0 text-xs font-bold uppercase tracking-wide text-ink-muted">Ảnh sửa URL</p>
          <p class="m-0 mt-1 text-xl font-extrabold text-brand-900">{{ repointResult.mediaUpdated }}</p>
        </div>
        <div class="rounded-lg border border-[#cce5cd] bg-[#eef7ee] p-3">
          <p class="m-0 text-xs font-bold uppercase tracking-wide text-ink-muted">Nội dung sửa URL</p>
          <p class="m-0 mt-1 text-xl font-extrabold text-brand-900">{{ repointResult.contentRowsUpdated }}</p>
        </div>
        <div v-if="repointResult.backupStamp" class="rounded-lg border border-[#f0dcae] bg-[#fdf6e7] p-3">
          <p class="m-0 text-xs font-bold uppercase tracking-wide text-[#8a6412]">Snapshot</p>
          <p class="m-0 mt-1 text-sm font-bold text-[#8a6412] break-all">{{ repointResult.backupStamp }}</p>
        </div>
      </div>
    </div>
  </section>
</template>
