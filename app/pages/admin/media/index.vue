<script setup lang="ts">
import type { AdminMediaRow } from '~/types/admin-api'
import type { AdminMediaDeleteResponse, AdminMediaListResponse, AdminMediaStorageSize } from '~/types/admin-media-api'
definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

const mediaItems = ref<AdminMediaRow[]>([])
const loading = ref(true)
const loadError = ref('')
const search = ref('')
const filterType = ref('')
const pagination = ref({ page: 1, totalPages: 1, total: 0 })
const isDragOver = ref(false)

const toast = useToast()
const { confirm } = useConfirm()
const { uploading, uploadBatch, tasks, uploadingBatch } = useUpload()

// Only the latest load writes (ticket, docs/decisions/fetch-rollout-d-fetch.md); a page past the end
// (last tile deleted) asks ONCE for the last page, not "Chưa có file nào" (tests/admin-fetch-rollout-media-library.test.ts).
// Leaving the page refuses new loads: a late answer's last-page follow-up, a delete/upload reload — nothing is sent.
let listRequest = 0, disposed = false
onBeforeUnmount(() => { disposed = true })
const fetchMedia = async (page = 1, mayAskForLastPage = true): Promise<void> => {
  if (disposed) return
  const ticket = ++listRequest
  loading.value = true
  loadError.value = ''
  try {
    const res = await adminFetch<AdminMediaListResponse>(`/api/admin/media`, { query: { page, search: search.value, type: filterType.value, perPage: 24 } })
    if (ticket !== listRequest) return
    const last = Math.max(1, res.pagination.totalPages)
    if (mayAskForLastPage && page > last && res.pagination.total > 0) return await fetchMedia(last, false)
    if (res.ok) {
      mediaItems.value = res.items
      pagination.value = res.pagination
      // Ids from the previous page are meaningless once the grid changes.
      selection.keepOnly(visibleIds.value)
    }
  } catch (err: unknown) {
    if (ticket !== listRequest) return
    loadError.value = errorMessage(err, 'Lỗi tải thư viện media')
    toast.error(loadError.value)
  } finally {
    if (ticket === listRequest) loading.value = false
  }
}

const handleUpload = async (files: FileList | File[]) => {
  const list = Array.from(files)
  if (!list.length) return
  const uploaded = await uploadBatch(list, 4)
  if (uploaded.length > 0) await fetchMedia(1)
}

const onFileInput = (e: Event) => {
  const files = (e.target as HTMLInputElement).files
  if (files?.length) handleUpload(files)
  ;(e.target as HTMLInputElement).value = ''
}

const onDrop = (e: DragEvent) => {
  isDragOver.value = false
  const files = e.dataTransfer?.files
  if (files?.length) handleUpload(files)
}

const copyLink = async (url: string) => {
  try {
    const absolute = new URL(url, window.location.origin).href
    await navigator.clipboard.writeText(absolute)
    toast.success('Đã sao chép liên kết!')
  } catch (err: unknown) {
    // Fallback cho trình duyệt không hỗ trợ clipboard API (HTTP, cũ).
    try {
      const ta = document.createElement('textarea')
      ta.value = new URL(url, window.location.origin).href
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      toast.success('Đã sao chép liên kết!')
    } catch {
      toast.error('Không sao chép được liên kết.')
    }
  }
}

const deleteMedia = async (item: AdminMediaRow) => {
  const ok = await confirm({ title: 'Xóa tệp', message: `Bạn có chắc muốn xóa file ${item.originalName}?`, danger: true, confirmLabel: 'Xóa' })
  if (!ok) return
  try {
    await adminFetch<AdminMediaDeleteResponse>(`/api/admin/media/${item.id}`, { method: 'DELETE' })
    toast.success('Đã xóa tệp media thành công!')
    await fetchMedia(pagination.value.page)
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Lỗi xóa file'))
  }
}

// ─── Bulk selection ───────────────────────────────────────────────────────────
const selection = useBulkSelection()
const bulk = useBulkAction(selection)
const visibleIds = computed(() => mediaItems.value.map((m: AdminMediaRow) => Number(m.id)))

const bulkDelete = () => bulk.run({
  url: '/api/admin/media/bulk-delete',
  noun: 'tệp',
  confirm: {
    title: 'Xóa tệp',
    // Worth spelling out: the file leaves storage too, so anything still linking
    // to it from an article body will break.
    message: `Xóa ${selection.count.value} tệp đã chọn? Tệp sẽ bị xóa khỏi kho lưu trữ và các liên kết đang dùng tệp này sẽ bị hỏng.`,
    danger: true,
    confirmLabel: 'Xóa',
  },
  reload: () => fetchMedia(pagination.value.page),
})

// Aggregate progress over the live task list — used by the zone label and the
// overall bar. pending counts as 0%, uploading ramps 5→95%, success is 100%.
const completedCount = computed(() => tasks.value.filter((t) => t.status === 'success' || t.status === 'error').length)
const totalCount = computed(() => tasks.value.length)
const batchPercent = computed(() => {
  if (!tasks.value.length) return 0
  return Math.round(tasks.value.reduce((sum, t) => sum + (t.status === 'success' ? 100 : t.progress), 0) / tasks.value.length)
})
const isBatching = computed(() => uploadingBatch.value && totalCount.value > 0)

// ─── Quét & đồng bộ storage chuyển sang trang riêng /admin/media/scan ──────
// Quét 3212 file mồ côi có thể treo trang grid, nên tách ra trang riêng chạy nền.

// ─── Dung lượng storage (local + R2) ────────────────────────────────────────
const storageSize = ref<AdminMediaStorageSize | null>(null)
const storageLoading = ref(false)
const storageError = ref('')

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

async function fetchStorageSize() {
  storageLoading.value = true
  storageError.value = ''
  try {
    const res = await adminFetch<AdminMediaStorageSize>('/api/admin/media/storage-size')
    if (res.ok) storageSize.value = res
  } catch (err: unknown) {
    storageError.value = errorMessage(err, 'Không thể lấy dung lượng storage.')
  } finally {
    storageLoading.value = false
  }
}

onMounted(() => { void fetchMedia(); void fetchStorageSize() })
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- Page Header -->
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-[1.3rem] font-extrabold text-brand-950 m-0">Thư viện Media & Tải lên</h1>
        <p class="text-[0.85rem] text-ink-muted mt-1 mb-0">Quản lý toàn bộ hình ảnh, tài liệu và video được tải lên website</p>
      </div>
      <NuxtLink
        to="/admin/media/scan"
        class="flex items-center gap-2 rounded-lg border border-line-strong bg-white px-3.5 py-2 text-sm font-semibold text-brand-700 no-underline transition-colors hover:bg-surface-tint"
      >
        <i class="fa-solid fa-folder-tree" aria-hidden="true"></i>
        Quét & Đồng bộ
      </NuxtLink>
    </div>

    <!-- Storage Usage Card -->
    <div class="bg-white rounded-xl border border-line p-4">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
        <div class="flex items-center gap-2">
          <i class="fa-solid fa-database text-brand-700" aria-hidden="true"></i>
          <h2 class="m-0 text-sm font-extrabold text-brand-950">Dung lượng đã sử dụng</h2>
        </div>
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-lg border border-line-strong bg-white px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-surface-tint transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="storageLoading"
          @click="fetchStorageSize"
        >
          <i class="fa-solid fa-rotate-right text-[0.7rem]" :class="storageLoading ? 'animate-spin motion-reduce:animate-none' : ''" aria-hidden="true"></i>
          <span>{{ storageLoading ? 'Đang quét...' : 'Quét lại dung lượng' }}</span>
        </button>
      </div>

      <div v-if="storageError" role="alert" class="flex items-center gap-2 text-xs text-danger-soft py-2">
        <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
        <span>{{ storageError }}</span>
      </div>

      <div v-else-if="storageLoading && !storageSize" class="flex items-center gap-2 text-xs text-ink-muted py-3" role="status" aria-busy="true">
        <i class="fa-solid fa-spinner animate-spin motion-reduce:animate-none" aria-hidden="true"></i>
        <span>Đang quét thư mục uploads và bucket R2...</span>
      </div>

      <div v-else-if="storageSize" class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <!-- Local -->
        <div class="rounded-lg border border-line bg-surface p-3.5">
          <div class="flex items-center justify-between gap-2 mb-2">
            <div class="flex items-center gap-2">
              <span class="inline-flex items-center justify-center w-7 h-7 rounded-md bg-brand-700 text-white text-xs">
                <i class="fa-solid fa-hard-drive" aria-hidden="true"></i>
              </span>
              <span class="text-sm font-bold text-brand-950">Local /uploads</span>
            </div>
            <span class="text-base font-extrabold text-brand-700">{{ formatBytes(storageSize.local.diskBytes) }}</span>
          </div>
          <ul class="m-0 p-0 list-none flex flex-col gap-1 text-[0.78rem] text-ink-muted">
            <li class="flex justify-between gap-2">
              <span>File trên đĩa</span>
              <span class="font-semibold text-[#3d4f3f]">{{ storageSize.local.diskCount.toLocaleString('vi-VN') }} tệp</span>
            </li>
            <li class="flex justify-between gap-2">
              <span>Đã ghi DB (local)</span>
              <span class="font-semibold text-[#3d4f3f]">{{ storageSize.local.dbCount.toLocaleString('vi-VN') }} tệp · {{ formatBytes(storageSize.local.dbBytes) }}</span>
            </li>
            <li v-if="storageSize.local.diskCount > storageSize.local.dbCount" class="flex justify-between gap-2 text-[#765b00]">
              <span>Mồ côi (chưa có DB)</span>
              <span class="font-semibold">{{ (storageSize.local.diskCount - storageSize.local.dbCount).toLocaleString('vi-VN') }} tệp</span>
            </li>
          </ul>
          <NuxtLink
            v-if="storageSize.local.diskCount > storageSize.local.dbCount"
            to="/admin/media/scan"
            class="mt-2 inline-flex items-center gap-1.5 text-[0.72rem] font-semibold text-brand-700 no-underline hover:underline"
          >
            <i class="fa-solid fa-arrow-right text-[0.6rem]" aria-hidden="true"></i>
            Quét & nhập tệp mồ côi
          </NuxtLink>
        </div>

        <!-- R2 -->
        <div class="rounded-lg border border-line bg-[#fffdf7] p-3.5">
          <div class="flex items-center justify-between gap-2 mb-2">
            <div class="flex items-center gap-2">
              <span class="inline-flex items-center justify-center w-7 h-7 rounded-md bg-orange-500 text-white text-xs">
                <i class="fa-solid fa-cloud" aria-hidden="true"></i>
              </span>
              <span class="text-sm font-bold text-brand-950">R2 Bucket</span>
            </div>
            <span v-if="storageSize.r2.bucketBytes != null" class="text-base font-extrabold text-[#7c4a00]">{{ formatBytes(storageSize.r2.bucketBytes) }}</span>
            <span v-else class="text-base font-extrabold text-[#9ca3af]">—</span>
          </div>
          <ul class="m-0 p-0 list-none flex flex-col gap-1 text-[0.78rem] text-ink-muted">
            <li v-if="!storageSize.r2.configured" class="text-[#9ca3af]">
              R2 chưa cấu hình — nhập credential ở Cài đặt.
            </li>
            <li v-else-if="storageSize.r2.bucketBytes == null" class="text-danger-soft">
              Không đọc được bucket R2 (credential hỏng hoặc lỗi mạng).
            </li>
            <template v-else>
              <li class="flex justify-between gap-2">
                <span>Object trong bucket</span>
                <span class="font-semibold text-[#3d4f3f]">{{ storageSize.r2.bucketCount!.toLocaleString('vi-VN') }} tệp</span>
              </li>
              <li class="flex justify-between gap-2">
                <span>Đã ghi DB (r2)</span>
                <span class="font-semibold text-[#3d4f3f]">{{ storageSize.r2.dbCount.toLocaleString('vi-VN') }} tệp · {{ formatBytes(storageSize.r2.dbBytes) }}</span>
              </li>
            </template>
          </ul>
        </div>
      </div>

      <p v-else class="m-0 text-xs text-ink-muted py-3">
        Chưa có thông tin dung lượng. Bấm “Quét lại dung lượng” để quét thư mục uploads và bucket R2.
      </p>
    </div>

    <!-- Upload Zone -->
    <label
      class="flex flex-col items-center justify-content-center gap-1.5 border-2 border-dashed border-line-strong rounded-2xl py-9 px-6 bg-surface cursor-pointer text-center transition-all duration-150"
      :class="{ 'border-brand-700 bg-[#edf7ed]': isDragOver, 'opacity-70 cursor-not-allowed pointer-events-none': uploading }"
      @dragover.prevent="isDragOver = true"
      @dragleave="isDragOver = false"
      @drop.prevent="onDrop"
    >
      <input type="file" accept="image/*,application/pdf" multiple class="sr-only" :disabled="uploading" @change="onFileInput" />
      <i class="fa-regular text-4xl" :class="uploading ? 'fa-spinner animate-spin text-brand-700' : 'fa-cloud-arrow-up text-brand-700'"></i>
      <strong class="mt-2 text-base text-[#1a2e1c]">{{ uploading ? (isBatching ? `Đang tải lên ${completedCount}/${totalCount}...` : 'Đang tải lên...') : 'Kéo thả file vào đây hoặc bấm để chọn' }}</strong>
      <span class="text-sm text-ink-muted">Hỗ trợ JPEG, PNG, WebP, GIF, PDF — tối đa 20MB mỗi file</span>
    </label>

    <!-- Per-file upload progress — parallel uploads, one row per file with its own state. -->
    <div v-if="tasks.length" class="bg-white rounded-xl border border-line p-4 flex flex-col gap-2.5" role="status" :aria-busy="isBatching">
      <div class="flex items-center justify-between gap-2">
        <strong class="text-sm text-brand-950 m-0">
          Đang tải lên {{ completedCount }}/{{ totalCount }} file{{ isBatching ? '' : ' — xong' }}
        </strong>
        <span class="text-[0.72rem] text-ink-muted">{{ batchPercent }}%</span>
      </div>
      <!-- Overall bar: aggregate of all rows below it. -->
      <div class="h-1.5 w-full overflow-hidden rounded-full bg-line">
        <div class="h-full rounded-full bg-brand-700 transition-[width] duration-200 motion-reduce:transition-none" :style="{ width: batchPercent + '%' }"></div>
      </div>
      <ul class="flex flex-col gap-2 m-0 p-0 list-none">
        <li
          v-for="t in tasks"
          :key="t.id"
          class="flex items-center gap-2.5 text-[0.8rem]"
        >
          <i
            class="fa-regular w-4 text-center"
            :class="{
              'fa-spinner animate-spin text-brand-700': t.status === 'pending' || t.status === 'uploading',
              'fa-circle-check text-brand-700': t.status === 'success',
              'fa-circle-xmark text-danger': t.status === 'error',
            }"
            :aria-hidden="true"
          ></i>
          <span class="flex-1 truncate text-brand-950" :title="t.file.name">{{ t.file.name }}</span>
          <span
            v-if="t.status === 'uploading' || t.status === 'pending'"
            class="w-9 text-right text-ink-muted"
          >{{ t.progress }}%</span>
          <span v-else-if="t.status === 'success'" class="w-9 text-right text-brand-700 font-semibold">OK</span>
          <span v-else-if="t.status === 'error'" class="w-9 text-right text-danger font-semibold" :title="t.error">Lỗi</span>
        </li>
      </ul>
    </div>

    <!-- Filter Bar -->
    <div class="bg-white rounded-xl border border-line p-4 flex flex-col sm:flex-row gap-3">
      <input
        type="text"
        v-model="search"
        placeholder="Tìm kiếm file..."
        @keyup.enter="fetchMedia(1)"
        class="flex-1 px-3.5 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15"
      />
      <select
        v-model="filterType"
        @change="fetchMedia(1)"
        class="px-3.5 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700"
      >
        <option value="">Tất cả định dạng</option>
        <option value="image">Chỉ Ảnh (Image)</option>
        <option value="video">Chỉ Video</option>
      </select>
      <button
        class="inline-flex items-center gap-2 bg-brand-700 hover:bg-brand-900 text-white font-bold px-4 py-2.5 rounded-lg cursor-pointer border-0 transition-colors"
        @click="fetchMedia(1)"
      >
        <i class="fa-regular fa-magnifying-glass"></i> Tìm kiếm
      </button>
    </div>

    <!-- Media Grid -->
    <SkeletonCards v-if="loading" label="Đang tải danh sách media" :count="12" />

    <div v-else-if="loadError" role="alert" class="flex flex-col items-center gap-3 py-16 text-danger-soft">
      <i class="fa-solid fa-triangle-exclamation text-4xl text-[#e2a0a0]" aria-hidden="true"></i>
      <p class="m-0 text-[0.9rem]">{{ loadError }}</p>
      <button type="button" class="inline-flex items-center gap-2 bg-brand-700 hover:bg-brand-900 text-white font-bold px-4 py-2 rounded-lg cursor-pointer border-0 transition-colors text-sm" @click="fetchMedia(1)">
        <i class="fa-solid fa-rotate-right" aria-hidden="true"></i> Thử lại
      </button>
    </div>

    <div v-else-if="mediaItems.length === 0" class="flex flex-col items-center gap-3 py-16 text-[#9ca3af]">
      <i class="fa-regular fa-images text-5xl text-[#d1d5db]"></i>
      <p class="m-0 text-[0.9rem]">Chưa có file nào. Hãy tải lên file đầu tiên!</p>
    </div>

    <!-- Bulk action bar -->
    <AdminBulkActionBar
      v-if="selection.count.value"
      :count="selection.count.value"
      :busy="bulk.busy.value"
      noun="tệp"
      @clear="selection.clear()"
    >
      <button type="button" class="rounded-lg bg-danger px-3 py-2 text-sm font-bold text-white hover:bg-[#b01f1b]" @click="bulkDelete">Xóa</button>
    </AdminBulkActionBar>

    <!-- A grid has no header row to hang "select all" off, so it gets its own control.
         !loadError is part of the condition, not decoration: a failed reload keeps
         the previous page's items in mediaItems, so without it the alert appears
         above a grid of stale tiles that look current. -->
    <label v-if="!loading && !loadError && mediaItems.length" class="flex w-fit items-center gap-2 text-sm font-semibold text-ink-admin">
      <input
        type="checkbox"
        class="h-4 w-4 accent-brand-700"
        :checked="selection.allSelected(visibleIds)"
        :indeterminate="selection.someSelected(visibleIds)"
        @change="selection.toggleAll(visibleIds)"
      />
      Chọn tất cả tệp trên trang
    </label>

    <div v-if="!loading && !loadError && mediaItems.length" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-4">
      <div
        v-for="m in mediaItems"
        :key="m.id"
        class="bg-white border rounded-xl overflow-hidden flex flex-col"
        :class="selection.isSelected(Number(m.id)) ? 'border-brand-700 ring-2 ring-brand-700/25' : 'border-line'"
      >
        <div class="h-[140px] bg-surface relative flex items-center justify-center">
          <img v-if="m.mimeType?.startsWith('image/')" :src="m.url" :alt="m.originalName" loading="lazy" class="w-full h-full object-cover" />
          <div v-else class="flex items-center justify-center">
            <i class="fa-regular fa-file-lines text-4xl text-[#9ca3af]"></i>
          </div>
          <!-- Corner checkbox: this is a card grid, not a table, so there is no
               row to put it in. White backing keeps it visible over any image. -->
          <label class="absolute top-2 left-2 flex h-6 w-6 cursor-pointer items-center justify-center rounded bg-white/90 shadow">
            <input
              type="checkbox"
              class="h-4 w-4 accent-brand-700"
              :checked="selection.isSelected(Number(m.id))"
              :aria-label="`Chọn tệp ${m.originalName}`"
              @change="selection.toggle(Number(m.id))"
            />
          </label>
          <span
            class="absolute top-2 right-2 text-[0.65rem] font-bold px-1.5 py-0.5 rounded text-white"
            :class="m.provider === 'r2' ? 'bg-orange-500' : 'bg-black/60'"
          >{{ m.provider?.toUpperCase() }}</span>
        </div>
        <div class="p-3 flex flex-col gap-1 flex-1">
          <span class="text-[0.82rem] font-bold text-brand-950 truncate" :title="m.originalName">{{ m.originalName }}</span>
          <span class="text-[0.72rem] text-[#9ca3af]">{{ (m.sizeBytes / 1024).toFixed(1) }} KB</span>
          <div class="flex gap-2 mt-1">
            <button
              type="button"
              class="flex-1 text-center text-[0.75rem] py-1 rounded-md bg-surface-tint text-brand-700 border-0 cursor-pointer hover:bg-[#e4f2e5] transition-colors font-medium"
              @click="copyLink(m.url)"
            ><i class="fa-regular fa-link"></i> Link</button>
            <button
              class="flex-1 text-[0.75rem] py-1 rounded-md bg-danger-bg text-danger border-0 cursor-pointer hover:bg-red-200 transition-colors font-medium"
              @click="deleteMedia(m)"
            ><i class="fa-regular fa-trash"></i> Xóa</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Pagination -->
    <div v-if="!loadError && pagination.totalPages > 1" class="mt-2">
      <AdminPagination
        :page="pagination.page"
        :total-pages="pagination.totalPages"
        @update:page="fetchMedia"
      />
    </div>
  </div>
</template>
