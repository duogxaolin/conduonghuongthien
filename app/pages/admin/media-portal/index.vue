<script setup lang="ts">
/**
 * Trang quản trị Thư viện Video (Media Portal).
 *
 * ## Tách biệt với `/admin/media`
 *
 * `/admin/media` phục vụ bảng `media` — thư viện ảnh cũ. Trang này phục vụ
 * `media_items` — kho video của tính năng Portal Media. Hai bảng khác nhau,
 * hai đường API khác nhau, hai tài nguyên RBAC khác nhau (`media` vs
 * `media_portal`). Nhầm chúng là trộn ảnh cũ lẫn video mới trên một màn hình mà
 * không có cách phân biệt, và một lượt đổi lược đồ ảnh hưởng tới bảng kia.
 *
 * ## Hợp đồng tải / lỗi / rỗng
 *
 * Ba nhánh theo thứ tự — `loading` / `loadError` / `!items.length` / dữ liệu —
 * vì đảo nhánh rỗng lên trước nhánh lỗi làm một lượt truy vấn hỏng đọc ra y hệt
 * "chưa có video nào", và cán bộ đi tạo lại bản ghi đã có. Nhánh lỗi mang
 * `role="alert"` để trình đọc màn hình thông báo; nút "Thử lại" gọi lại
 * `fetchMedia()` khai báo trong cùng tệp, không tải lại trang.
 *
 * ## Bộ lọc theo URL
 *
 * `q` (tìm kiếm), `status` (trạng thái), `source` (nguồn), `page` — tất cả
 * sống trong query string để chia sẻ được và sống qua F5. Số trang qua
 * `Number.isFinite` trước khi dùng, không `Math.max(1, Number('abc'))` vì
 * `NaN` lọt qua mọi so sánh.
 */
import type { AdminMediaItem, AdminMediaPage, AdminMediaConfig } from '~/types/admin-api'

definePageMeta({
  layout: 'admin',
  middleware: 'admin-auth'
})

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { hasPermission } = useAdminAuth()

type MediaStatus = 'draft' | 'published' | 'archived'
type MediaSource = 'upload' | 'youtube'

const STATUS_OPTIONS: { value: '' | MediaStatus; label: string }[] = [
  { value: '',          label: 'Tất cả trạng thái' },
  { value: 'draft',     label: 'Bản nháp' },
  { value: 'published', label: 'Đã xuất bản' },
  { value: 'archived',   label: 'Đã lưu trữ' },
]

const SOURCE_OPTIONS: { value: '' | MediaSource; label: string }[] = [
  { value: '',       label: 'Tất cả nguồn' },
  { value: 'upload', label: 'Tải lên' },
  { value: 'youtube',label: 'YouTube' },
]

const items = ref<AdminMediaItem[]>([])
const total = ref(0)
const loading = ref(true)
const loadError = ref('')
const mediaConfig = ref<AdminMediaConfig | null>(null)

const PER_PAGE = 20

const search = ref((route.query.search as string) || '')
const statusFilter = ref<'' | MediaStatus>(
  STATUS_OPTIONS.some(o => o.value === route.query.status) ? (route.query.status as MediaStatus) : ''
)
const sourceFilter = ref<'' | MediaSource>(
  SOURCE_OPTIONS.some(o => o.value === route.query.source) ? (route.query.source as MediaSource) : ''
)

const rawPage = Number(route.query.page)
const currentPage = ref(Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1)
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PER_PAGE)))

const canCreate = hasPermission('media_portal', 'create')
const canUpdate = hasPermission('media_portal', 'update')
const canDelete = hasPermission('media_portal', 'delete')

async function fetchMedia() {
  loading.value = true
  loadError.value = ''
  try {
    const [res, capabilities] = await Promise.all([($fetch as (u: string, o?: Record<string, unknown>) => Promise<AdminMediaPage>)(`/api/admin/media-portal`, {
      params: {
        page:   currentPage.value,
        limit:  PER_PAGE,
        search: search.value || undefined,
        status: statusFilter.value || undefined,
        source: sourceFilter.value || undefined,
      },
    }), ($fetch as (u: string, o?: Record<string, unknown>) => Promise<AdminMediaConfig>)(`/api/admin/media-portal/config`)])
    mediaConfig.value = capabilities
    items.value = res.items
    total.value = res.total
    currentPage.value = res.page
  } catch (err: unknown) {
    loadError.value = errorMessage(err, 'Không tải được danh sách video.')
  } finally {
    loading.value = false
  }
}

function applyFilters() {
  currentPage.value = 1
  void router.replace({
    query: {
      ...(search.value ? { search: search.value } : {}),
      ...(statusFilter.value ? { status: statusFilter.value } : {}),
      ...(sourceFilter.value ? { source: sourceFilter.value } : {}),
      ...(currentPage.value !== 1 ? { page: currentPage.value } : {}),
    }
  })
  void fetchMedia()
}

function changePage(page: number) {
  if (!Number.isFinite(page) || page < 1 || page > totalPages.value) return
  currentPage.value = page
  void fetchMedia()
}

async function deleteItem(id: number, title: string) {
  if (!confirm(`Xoá video "${title}"? Hành động này không thể hoàn tác.`)) return
  try {
    await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)(`/api/admin/media-portal/${id}`, { method: 'DELETE' })
    toast.success('Đã xoá video.')
    await fetchMedia()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể xoá video.'))
  }
}

function statusLabel(s: string): string {
  const opt = STATUS_OPTIONS.find(o => o.value === s)
  return opt ? opt.label : s
}

function statusBadgeClass(s: string): string {
  if (s === 'published') return 'bg-[#e6f4ea] text-[#2c6e33]'
  if (s === 'archived') return 'bg-[#f0f0f0] text-[#666]'
  return 'bg-[#fff3cd] text-[#856404]'
}

function processingLabel(status: string): string {
  if (status === 'pending') return 'Đang chờ xử lý'
  if (status === 'ready') return 'Sẵn sàng'
  if (status === 'processing') return 'Đang xử lý'
  if (status === 'failed') return 'Lỗi xử lý'
  return status
}

function fmtDuration(secs: number | null): string {
  if (!secs || secs <= 0) return '—'
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function fmtDate(v: string | null): string {
  if (!v) return '—'
  return new Date(v).toLocaleDateString('vi-VN')
}

onMounted(() => { void fetchMedia() })
</script>

<template>
  <div class="p-4 md:p-6 lg:p-8 space-y-6">
    <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold text-[#2c3e2e]">Thư viện Video</h1>
        <p class="text-sm text-[#6b7d6c] mt-1">Quản lý video của Portal Media — tải lên, xuất bản, gỡ bỏ.</p>
      </div>
      <div class="flex gap-2">
        <NuxtLink
          v-if="canCreate"
          to="/admin/media-portal/external"
          class="inline-flex items-center gap-2 rounded-lg bg-[#4A6741] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3d5636] transition-colors"
        >
          <i class="fa-solid fa-plus" aria-hidden="true"></i>
          Đăng video YouTube
        </NuxtLink>
        <NuxtLink
          v-if="canCreate && mediaConfig?.uploadEnabled && hasPermission('media_portal', 'read')"
          to="/admin/media-portal/upload"
          class="inline-flex items-center gap-2 rounded-lg bg-[#2c6e33] px-4 py-2 text-sm font-semibold text-white hover:bg-[#245830] transition-colors"
        >
          <i class="fa-solid fa-upload" aria-hidden="true"></i>
          Tải video lên
        </NuxtLink>
      </div>
    </div>

    <!-- Filters -->
    <div class="bg-white rounded-xl border border-[#e2ece3] p-4 flex flex-col md:flex-row gap-3">
      <div class="flex-1">
        <input
          v-model="search"
          aria-label="Tìm video theo tiêu đề"
          type="text"
          placeholder="Tìm theo tiêu đề..."
          class="w-full rounded-lg border border-[#dde6de] px-3 py-2 text-sm outline-none focus:border-[#4A6741]"
          @keydown.enter="applyFilters"
        />
      </div>
      <select
        v-model="statusFilter"
        aria-label="Lọc trạng thái xuất bản"
        class="rounded-lg border border-[#dde6de] px-3 py-2 text-sm outline-none focus:border-[#4A6741]"
        @change="applyFilters"
      >
        <option v-for="o in STATUS_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
      </select>
      <select
        v-model="sourceFilter"
        aria-label="Lọc nguồn video"
        class="rounded-lg border border-[#dde6de] px-3 py-2 text-sm outline-none focus:border-[#4A6741]"
        @change="applyFilters"
      >
        <option v-for="o in SOURCE_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
      </select>
      <button
        type="button"
        class="rounded-lg bg-[#4A6741] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3d5636] transition-colors"
        @click="applyFilters"
      >
        Lọc
      </button>
    </div>

    <!-- Table -->
    <div class="bg-white rounded-xl border border-[#e2ece3] overflow-hidden">
      <!-- Loading -->
      <div v-if="loading" role="status" aria-busy="true" class="p-6">
        <span class="sr-only">Đang tải danh sách video</span>
        <div class="flex flex-col gap-3 animate-pulse motion-reduce:animate-none">
          <div v-for="n in 6" :key="n" class="flex gap-3">
            <div v-for="c in 6" :key="c" class="h-10 bg-[#EEF2EC] rounded flex-1" aria-hidden="true"></div>
          </div>
        </div>
      </div>

      <!-- Error -->
      <div v-else-if="loadError" role="alert" class="px-6 py-10 text-center text-[#B04A4A] text-[0.95rem]">
        <i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>
        {{ loadError }} Vui lòng <button type="button" class="text-[#4A6741] font-bold underline" @click="fetchMedia()">thử lại</button>.
      </div>

      <!-- Empty -->
      <div v-else-if="items.length === 0" class="px-6 py-12 text-center text-[#6b7d6c] text-[0.95rem]">
        <i class="fa-solid fa-video-slash text-3xl mb-3 text-[#c5d3c7]" aria-hidden="true"></i>
        <p>Chưa có video nào{{ search || statusFilter || sourceFilter ? ' khớp bộ lọc' : '' }}.</p>
        <p v-if="canCreate" class="mt-2 text-xs">Bấm "Tải video lên" hoặc "Đăng video YouTube" để bắt đầu.</p>
      </div>

      <!-- Data -->
      <div v-else>
        <!-- Desktop table -->
        <table class="w-full text-sm hidden md:table">
          <thead class="bg-[#f4f7f4] text-[#6b7d6c]">
            <tr>
              <th class="px-4 py-3 text-left font-semibold">Tiêu đề</th>
              <th class="px-4 py-3 text-left font-semibold">Nguồn</th>
              <th class="px-4 py-3 text-left font-semibold">Thời lượng</th>
              <th class="px-4 py-3 text-left font-semibold">Trạng thái</th>
              <th class="px-4 py-3 text-left font-semibold">Xử lý</th>
              <th class="px-4 py-3 text-left font-semibold">Lượt xem</th>
              <th class="px-4 py-3 text-left font-semibold">Cập nhật</th>
              <th class="px-4 py-3 text-right font-semibold">Thao tác</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[#eef2ee]">
            <tr v-for="item in items" :key="item.id" class="hover:bg-[#f8fbf8]">
              <td class="px-4 py-3">
                <div class="font-medium text-[#2c3e2e] line-clamp-1">{{ item.title }}</div>
                <div v-if="item.categoryName" class="text-xs text-[#8aa08c]">{{ item.categoryName }}</div>
              </td>
              <td class="px-4 py-3">
                <span class="inline-flex items-center gap-1 text-xs text-[#6b7d6c]">
                  <i :class="item.source === 'youtube' ? 'fa-solid fa-youtube text-[#ff0000]' : 'fa-solid fa-upload'" aria-hidden="true"></i>
                  {{ item.source === 'youtube' ? 'YouTube' : 'Tải lên' }}
                </span>
              </td>
              <td class="px-4 py-3 text-[#6b7d6c]">{{ fmtDuration(item.durationSeconds) }}</td>
              <td class="px-4 py-3">
                <span class="inline-block rounded-full px-2 py-0.5 text-xs font-medium" :class="statusBadgeClass(item.status)">
                  {{ statusLabel(item.status) }}
                </span>
              </td>
              <td class="px-4 py-3 text-xs">
                <span :class="item.processingStatus === 'failed' ? 'text-[#B04A4A]' : 'text-[#6b7d6c]'">
                  {{ processingLabel(item.processingStatus) }}
                </span>
              </td>
              <td class="px-4 py-3 text-[#6b7d6c]">{{ item.viewCount.toLocaleString('vi-VN') }}</td>
              <td class="px-4 py-3 text-[#6b7d6c]">{{ fmtDate(item.updatedAt) }}</td>
              <td class="px-4 py-3 text-right">
                <div class="flex justify-end gap-1">
                  <NuxtLink
                    :to="`/admin/media-portal/${item.id}`"
                    class="inline-flex items-center justify-center w-8 h-8 rounded-lg hover:bg-[#e6f4ea] text-[#4A6741]"
                    :title="canUpdate ? 'Sửa' : 'Xem'"
                    :aria-label="`${canUpdate ? 'Sửa' : 'Xem'} video ${item.title}`"
                  >
                    <i class="fa-solid fa-pen text-xs" aria-hidden="true"></i>
                  </NuxtLink>
                  <button
                    v-if="canDelete"
                    type="button"
                    class="inline-flex items-center justify-center w-8 h-8 rounded-lg hover:bg-[#fbe6e6] text-[#B04A4A]"
                    :title="'Xoá'"
                    @click="deleteItem(item.id, item.title)"
                  >
                    <i class="fa-solid fa-trash text-xs" aria-hidden="true"></i>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        <!-- Mobile cards -->
        <div class="md:hidden divide-y divide-[#eef2ee]">
          <div v-for="item in items" :key="'m-'+item.id" class="p-4">
            <div class="flex items-start justify-between gap-2">
              <div class="flex-1 min-w-0">
                <div class="font-medium text-[#2c3e2e] line-clamp-2">{{ item.title }}</div>
                <div class="text-xs text-[#8aa08c] mt-1">
                  {{ item.source === 'youtube' ? 'YouTube' : 'Tải lên' }}
                  · {{ fmtDuration(item.durationSeconds) }}
                  · {{ item.viewCount.toLocaleString('vi-VN') }} lượt xem
                </div>
              </div>
              <span class="inline-block rounded-full px-2 py-0.5 text-xs font-medium shrink-0" :class="statusBadgeClass(item.status)">
                {{ statusLabel(item.status) }}
              </span>
            </div>
            <div class="flex gap-1 mt-3">
              <NuxtLink
                :to="`/admin/media-portal/${item.id}`"
                class="inline-flex items-center justify-center flex-1 h-9 rounded-lg bg-[#e6f4ea] text-[#4A6741] text-sm font-medium hover:bg-[#dcf0e0]"
              >
                <i class="fa-solid fa-pen mr-1.5 text-xs" aria-hidden="true"></i> {{ canUpdate ? 'Sửa' : 'Xem' }}
              </NuxtLink>
              <button
                v-if="canDelete"
                type="button"
                class="inline-flex items-center justify-center flex-1 h-9 rounded-lg bg-[#fbe6e6] text-[#B04A4A] text-sm font-medium hover:bg-[#f8d8d8]"
                @click="deleteItem(item.id, item.title)"
              >
                <i class="fa-solid fa-trash mr-1.5 text-xs" aria-hidden="true"></i> Xoá
              </button>
            </div>
          </div>
        </div>

        <!-- Pagination -->
        <div v-if="totalPages > 1" class="flex items-center justify-between px-4 py-3 border-t border-[#eef2ee] text-sm">
          <div class="text-[#6b7d6c]">
            Trang {{ currentPage }} / {{ totalPages }}
            <span class="text-[#8aa08c]">· {{ total }} video</span>
          </div>
          <div class="flex gap-2">
            <button
              type="button"
              class="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-[#dde6de] text-[#4A6741] disabled:opacity-40 disabled:cursor-not-allowed"
              :disabled="currentPage <= 1"
              @click="changePage(currentPage - 1)"
            >
              <i class="fa-solid fa-chevron-left text-xs" aria-hidden="true"></i>
            </button>
            <button
              type="button"
              class="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-[#dde6de] text-[#4A6741] disabled:opacity-40 disabled:cursor-not-allowed"
              :disabled="currentPage >= totalPages"
              @click="changePage(currentPage + 1)"
            >
              <i class="fa-solid fa-chevron-right text-xs" aria-hidden="true"></i>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
