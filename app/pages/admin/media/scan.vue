<script setup lang="ts">
import type { AdminMediaRow } from '~/types/admin-api'
definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

const toast = useToast()

// ─── Quét thư mục uploads ─────────────────────────────────────────────────────
// Ai đó copy ảnh thẳng vào public/uploads/ (SCP, rsync, backup) thì tệp tồn tại
// trên đĩa nhưng không có hàng `media` → không hiện trên cổng. Nút này quét + tự
// động tạo hàng cho mọi tệp mồ côi.
const scanning = ref(false)
const scanResult = ref<{ imported: number; skipped: number; truncated: boolean } | null>(null)

const scanFolder = async () => {
  scanning.value = true
  scanResult.value = null
  try {
    const res = await $fetch<{ ok: boolean, imported: number, skipped: number, truncated: boolean }>('/api/admin/media/scan', { method: 'POST' })
    scanResult.value = { imported: res.imported, skipped: res.skipped, truncated: res.truncated }
    if (res.imported > 0) {
      toast.success(`Đã nhập ${res.imported} tệp ảnh vào thư viện${res.skipped > 0 ? `, bỏ qua ${res.skipped} tệp` : ''}.`)
    } else if (res.skipped > 0) {
      toast.info(`Không có tệp mới. Bỏ qua ${res.skipped} tệp (không phải ảnh hoặc đã có).`)
    } else {
      toast.info('Không có tệp mới để nhập.')
    }
    if (res.truncated) toast.warning('Đã đạt giới hạn 5000 tệp/lượt quét. Chạy lại để quét tiếp.')
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Lỗi quét thư mục'))
  } finally {
    scanning.value = false
  }
}

// ─── Đồng bộ storage (local ↔ R2) ────────────────────────────────────────────
// Chuyển toàn bộ ảnh sang storage bên kia: tải sang, xoá bản cũ, cập nhật URL
// trong SQL + rich-text bài viết. Chỉ ảnh (bảng `media`), không video.
const syncing = ref(false)
const syncDirection = ref<'to-r2' | 'to-local' | ''>('')
const syncResult = ref<{ synced: number; skipped: number; articlesRewritten: number } | null>(null)
const counts = ref<{ local: number; r2: number }>({ local: 0, r2: 0 })

const loadCounts = async () => {
  try {
    const res = await $fetch<{ local: number; r2: number }>('/api/admin/media/counts')
    counts.value = { local: res.local ?? 0, r2: res.r2 ?? 0 }
  } catch { /* không chặn trang */ }
}

const syncStorage = async (direction: 'to-r2' | 'to-local') => {
  syncing.value = true
  syncDirection.value = direction
  syncResult.value = null
  try {
    const res = await $fetch<{ ok: boolean, synced: number, skipped: number, errors: string[], articlesRewritten: number }>('/api/admin/media/sync-storage', {
      method: 'POST',
      body: { direction },
    })
    syncResult.value = { synced: res.synced, skipped: res.skipped, articlesRewritten: res.articlesRewritten }
    if (res.synced > 0) {
      toast.success(`Đã chuyển ${res.synced} ảnh sang ${direction === 'to-r2' ? 'R2' : 'local'}${res.skipped > 0 ? `, bỏ qua ${res.skipped}` : ''}.${res.articlesRewritten > 0 ? ` Đã sửa URL trong ${res.articlesRewritten} bài viết.` : ''}`)
    } else if (res.skipped > 0) {
      toast.info(`Không chuyển được ảnh nào. Bỏ qua ${res.skipped} ảnh lỗi.`)
    } else {
      toast.info('Không có ảnh cần chuyển.')
    }
    await loadCounts()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Lỗi đồng bộ storage'))
  } finally {
    syncing.value = false
    syncDirection.value = ''
  }
}

onMounted(() => { loadCounts() })
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- Page Header -->
    <div>
      <h1 class="text-[1.3rem] font-extrabold text-[#122815] m-0">Quét & Đồng bộ Media</h1>
      <p class="text-[0.85rem] text-[#667768] mt-1 mb-0">Thao tác hàng loạt lên thư viện ảnh — quét tệp mồ côi và chuyển storage giữa local / R2.</p>
    </div>

    <!-- Nút quay lại -->
    <NuxtLink to="/admin/media" class="inline-flex w-fit items-center gap-2 text-sm font-semibold text-[#2c6e33] no-underline hover:underline">
      <i class="fa-regular fa-arrow-left" aria-hidden="true"></i> Về Thư viện Media
    </NuxtLink>

    <!-- ─── Section 1: Quét thư mục ───────────────────────────────────────── -->
    <section class="rounded-xl border border-[#e2ece3] bg-white p-5 flex flex-col gap-3">
      <header class="flex items-start gap-3">
        <i class="fa-solid fa-folder-tree text-2xl text-[#2c6e33] mt-0.5" aria-hidden="true"></i>
        <div>
          <h2 class="m-0 text-base font-bold text-[#122815]">Quét thư mục ảnh mồ côi</h2>
          <p class="m-0 mt-1 text-[0.82rem] text-[#667768]">Duyệt đệ quy <code class="rounded bg-[#f0f7f1] px-1.5 py-0.5 font-mono text-[0.78rem]">public/uploads/</code> và tự động nhập ảnh chưa có hàng CSDL. Hữu ích khi copy ảnh thẳng vào thư mục (SCP, rsync, backup).</p>
        </div>
      </header>

      <div class="flex flex-wrap items-center gap-3">
        <button
          type="button"
          class="inline-flex items-center gap-2 rounded-lg bg-[#2c6e33] px-4 py-2.5 text-sm font-bold text-white border-0 cursor-pointer transition-colors hover:bg-[#1e4620] disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="scanning"
          :aria-busy="scanning"
          @click="scanFolder"
        >
          <i class="fa-solid fa-folder-tree" :class="scanning ? 'fa-spinner animate-spin' : ''" aria-hidden="true"></i>
          {{ scanning ? 'Đang quét...' : 'Bắt đầu quét' }}
        </button>
        <span v-if="scanning" class="text-sm text-[#667768]">Đang duyệt thư mục, có thể mất vài phút nếu có nhiều file.</span>
      </div>

      <!-- Kết quả quét -->
      <div v-if="scanResult" class="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-2">
        <div class="rounded-lg border border-[#cce5cd] bg-[#eef7ee] p-3">
          <p class="m-0 text-xs font-bold uppercase tracking-wide text-[#667768]">Đã nhập</p>
          <p class="m-0 mt-1 text-xl font-extrabold text-[#1e4620]">{{ scanResult.imported }}</p>
        </div>
        <div class="rounded-lg border border-[#e2ece3] bg-[#f8faf8] p-3">
          <p class="m-0 text-xs font-bold uppercase tracking-wide text-[#667768]">Bỏ qua</p>
          <p class="m-0 mt-1 text-xl font-extrabold text-[#667768]">{{ scanResult.skipped }}</p>
        </div>
        <div v-if="scanResult.truncated" class="rounded-lg border border-[#f0dcae] bg-[#fdf6e7] p-3">
          <p class="m-0 text-xs font-bold uppercase tracking-wide text-[#8a6412]">Cắt ngang</p>
          <p class="m-0 mt-1 text-sm font-bold text-[#8a6412]">Đạt 5000 tệp — chạy lại để quét tiếp</p>
        </div>
      </div>
      <p v-if="scanResult && scanResult.imported > 0" class="m-0 text-sm">
        <NuxtLink to="/admin/media" class="text-[#2c6e33] font-semibold no-underline hover:underline">Xem thư viện →</NuxtLink>
      </p>
    </section>

    <!-- ─── Section 2: Đồng bộ storage ────────────────────────────────────── -->
    <section class="rounded-xl border border-[#e2ece3] bg-white p-5 flex flex-col gap-3">
      <header class="flex items-start gap-3">
        <i class="fa-solid fa-cloud-arrow-up text-2xl text-[#2c6e33] mt-0.5" aria-hidden="true"></i>
        <div>
          <h2 class="m-0 text-base font-bold text-[#122815]">Đồng bộ storage ảnh</h2>
          <p class="m-0 mt-1 text-[0.82rem] text-[#667768]">Chuyển toàn bộ ảnh sang storage bên kia — tải sang, xoá bản cũ, cập nhật URL trong CSDL + bài viết. Chỉ ảnh (bảng <code class="font-mono">media</code>).</p>
        </div>
      </header>

      <!-- Số lượng hiện tại -->
      <div class="grid grid-cols-2 gap-3">
        <div class="rounded-lg border border-[#e2ece3] bg-[#f8faf8] p-3 text-center">
          <p class="m-0 text-xs font-bold uppercase tracking-wide text-[#667768]">Local</p>
          <p class="m-0 mt-1 text-xl font-extrabold text-[#122815]">{{ counts.local }}</p>
        </div>
        <div class="rounded-lg border border-[#e2ece3] bg-[#f8faf8] p-3 text-center">
          <p class="m-0 text-xs font-bold uppercase tracking-wide text-[#667768]">R2</p>
          <p class="m-0 mt-1 text-xl font-extrabold text-[#122815]">{{ counts.r2 }}</p>
        </div>
      </div>

      <!-- Cảnh báo -->
      <div class="rounded-lg border border-[#f0dcae] bg-[#fdf6e7] px-3.5 py-2.5 text-[0.82rem] text-[#8a6412]" role="status">
        <i class="fa-solid fa-triangle-exclamation mt-0.5 mr-1.5" aria-hidden="true"></i>
        <span>Ảnh đã nhúng trong bài viết sẽ được tự thay URL sang storage mới. Sao lưu CSDL trước khi sync để phòng lỗi.</span>
      </div>

      <!-- Nút đồng bộ -->
      <div class="flex flex-wrap gap-3">
        <button
          type="button"
          class="inline-flex items-center gap-2 rounded-lg border border-[#c8d6c9] bg-white px-4 py-2.5 text-sm font-bold text-[#2c6e33] cursor-pointer transition-colors hover:bg-[#f0f7f1] disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="syncing || counts.local === 0"
          :aria-busy="syncing && syncDirection === 'to-r2'"
          @click="syncStorage('to-r2')"
        >
          <i class="fa-solid fa-cloud-arrow-up" :class="syncing && syncDirection === 'to-r2' ? 'fa-spinner animate-spin' : ''" aria-hidden="true"></i>
          {{ syncing && syncDirection === 'to-r2' ? 'Đang chuyển lên R2...' : 'Đồng bộ lên R2' }}
        </button>
        <button
          type="button"
          class="inline-flex items-center gap-2 rounded-lg border border-[#c8d6c9] bg-white px-4 py-2.5 text-sm font-bold text-[#2c6e33] cursor-pointer transition-colors hover:bg-[#f0f7f1] disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="syncing || counts.r2 === 0"
          :aria-busy="syncing && syncDirection === 'to-local'"
          @click="syncStorage('to-local')"
        >
          <i class="fa-solid fa-cloud-arrow-down" :class="syncing && syncDirection === 'to-local' ? 'fa-spinner animate-spin' : ''" aria-hidden="true"></i>
          {{ syncing && syncDirection === 'to-local' ? 'Đang chuyển về local...' : 'Đồng bộ về local' }}
        </button>
      </div>
      <p v-if="syncing" class="m-0 text-sm text-[#667768]">Đang chuyển ảnh, có thể mất vài phút nếu có nhiều file.</p>

      <!-- Kết quả sync -->
      <div v-if="syncResult" class="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-2">
        <div class="rounded-lg border border-[#cce5cd] bg-[#eef7ee] p-3">
          <p class="m-0 text-xs font-bold uppercase tracking-wide text-[#667768]">Đã chuyển</p>
          <p class="m-0 mt-1 text-xl font-extrabold text-[#1e4620]">{{ syncResult.synced }}</p>
        </div>
        <div class="rounded-lg border border-[#e2ece3] bg-[#f8faf8] p-3">
          <p class="m-0 text-xs font-bold uppercase tracking-wide text-[#667768]">Bỏ qua</p>
          <p class="m-0 mt-1 text-xl font-extrabold text-[#667768]">{{ syncResult.skipped }}</p>
        </div>
        <div class="rounded-lg border border-[#cce5cd] bg-[#eef7ee] p-3">
          <p class="m-0 text-xs font-bold uppercase tracking-wide text-[#667768]">Bài viết sửa URL</p>
          <p class="m-0 mt-1 text-xl font-extrabold text-[#1e4620]">{{ syncResult.articlesRewritten }}</p>
        </div>
      </div>
    </section>
  </div>
</template>
