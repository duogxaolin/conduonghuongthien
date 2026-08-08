<script setup lang="ts">
import type { AdminSubmissionRow } from '~/types/admin-api'
import {
  SUBMISSION_STATUSES,
  SUBMISSION_STATUS_META,
  isSubmissionStatus,
  type SubmissionStatus,
} from '~/utils/submission-status'

definePageMeta({
  layout: 'admin',
  middleware: 'admin-auth'
})

const submissions = ref<AdminSubmissionRow[]>([])
const counts = ref<Record<string, number>>({})
const loading = ref(true)
const error = ref('')
const search = ref('')
/** Id đang mở trong modal chi tiết — modal tự tải nhật ký xử lý của nó. */
const openId = ref<number | null>(null)

// Hai bộ lọc này đi tới MÁY CHỦ (chúng quyết định tập bản ghi), khác ô tìm kiếm
// bên dưới vốn chỉ thu hẹp thứ đang hiển thị. Trộn hai cách lọc trên cùng một
// trang là chủ đích — xem lời giải thích ở endpoint.
const statusFilter = ref<'' | SubmissionStatus>('')
const viewedFilter = ref<'' | 'yes' | 'no'>('')

const fetchSubmissions = async () => {
  loading.value = true
  error.value = ''
  try {
    const res = await $fetch('/api/admin/submissions', {
      query: {
        status: statusFilter.value || undefined,
        viewed: viewedFilter.value || undefined,
      },
    })
    if (res.ok) {
      submissions.value = res.submissions
      counts.value = res.counts
    } else {
      error.value = 'Không tải được danh sách đơn đăng ký.'
    }
  } catch (err: unknown) {
    error.value = errorMessage(err, 'Không tải được danh sách đơn đăng ký.')
  } finally {
    loading.value = false
  }
}

// Đổi bộ lọc là một lượt tải lại từ máy chủ, không phải lọc trên tập đã có.
watch([statusFilter, viewedFilter], () => { fetchSubmissions() })

// The API returns the raw submissions row shape (fullName/phone/email/address/
// message/answers/formTitle/createdAt) — filter against those real columns.
const filteredSubmissions = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return submissions.value
  return submissions.value.filter(s =>
    s.fullName?.toLowerCase().includes(q) ||
    s.phone?.includes(search.value.trim()) ||
    s.address?.toLowerCase().includes(q) ||
    s.formTitle?.toLowerCase().includes(q)
  )
})

// Hàng cũ có `status` rỗng (trước khi cột tồn tại) đọc về mặc định — một huy hiệu
// trắng trơn trên trang quản trị đọc ra là dữ liệu bị hỏng.
const statusOf = (s: AdminSubmissionRow): SubmissionStatus =>
  isSubmissionStatus(s.status) ? s.status : 'new'

/** Tổng số đơn — cộng từ số đếm toàn bảng, không đếm mảng đang hiển thị. */
const totalCount = computed(() =>
  SUBMISSION_STATUSES.reduce((sum, key) => sum + (counts.value[key] ?? 0), 0)
)

/** Trạng thái dùng được cho hành động hàng loạt: `new` không phải một đích đến. */
const bulkStatusChoices = SUBMISSION_STATUSES.filter((s) => s !== 'new')

const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleString('vi-VN') : '—')

// ─── Bulk selection ───────────────────────────────────────────────────────────
const selection = useBulkSelection()
const bulk = useBulkAction(selection)

// Search filters client-side here, so the selectable set is the filtered list —
// a row the operator cannot currently see must not be in the lot.
const visibleIds = computed(() => filteredSubmissions.value.map((s) => Number(s.id)))

// Selection survives typing in the search box but drops rows the filter hid, so
// narrowing the search can never widen what a delete would touch. This also
// covers the reload after a delete, when the removed rows leave the list.
watch(visibleIds, (ids) => selection.keepOnly(ids))

const bulkDelete = () => bulk.run({
  url: '/api/admin/submissions/bulk-delete',
  noun: 'đơn đăng ký',
  confirm: {
    title: 'Xóa đơn đăng ký',
    // Spelled out because this is citizens' contact data and there is no archive
    // to fall back on — the row is gone from the database.
    message: `Xóa ${selection.count.value} đơn đăng ký đã chọn? Thông tin liên hệ của người dân sẽ bị xóa vĩnh viễn và không thể phục hồi.`,
    danger: true,
    confirmLabel: 'Xóa',
  },
  reload: fetchSubmissions,
})

const bulkStatus = (status: SubmissionStatus) => bulk.run({
  url: '/api/admin/submissions/bulk-status',
  body: { status },
  noun: 'đơn đăng ký',
  confirm: {
    title: 'Đổi trạng thái xử lý',
    message: `Chuyển ${selection.count.value} đơn đã chọn sang "${SUBMISSION_STATUS_META[status].label}"?`,
    confirmLabel: 'Chuyển',
  },
  reload: fetchSubmissions,
})

onMounted(() => { fetchSubmissions() })
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- Page Header -->
    <div>
      <h1 class="text-[1.3rem] font-extrabold text-[#122815] m-0">Danh sách Đơn đăng ký Hỗ trợ</h1>
      <p class="text-[0.85rem] text-[#667768] mt-1 mb-0">Tiếp nhận và xử lý thông tin từ người dân đăng ký tư vấn tái hòa nhập cộng đồng</p>
    </div>

    <!-- Status tiles. Con số đọc từ CẢ BẢNG, không theo bộ lọc đang áp: ô tổng trả
         lời "tồn đọng đang thế nào", còn bộ lọc là lựa chọn hiển thị của người
         đang xem. Bấm một ô là áp đúng bộ lọc đó, bấm lại là bỏ. -->
    <div v-if="!loading && !error" class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <button
        type="button"
        class="flex flex-col items-start gap-1 rounded-xl border bg-white p-3 text-left transition-shadow hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-[#2c6e33]/25"
        :class="statusFilter === '' ? 'border-[#2c6e33]' : 'border-[#e2ece3]'"
        :aria-pressed="statusFilter === ''"
        @click="statusFilter = ''"
      >
        <span class="text-[0.75rem] font-bold text-[#667768]">Tất cả</span>
        <span class="text-[1.15rem] font-extrabold text-[#122815]">{{ totalCount }}</span>
      </button>
      <button
        v-for="key in SUBMISSION_STATUSES"
        :key="key"
        type="button"
        class="flex flex-col items-start gap-1 rounded-xl border bg-white p-3 text-left transition-shadow hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-[#2c6e33]/25"
        :class="statusFilter === key ? 'border-[#2c6e33]' : 'border-[#e2ece3]'"
        :aria-pressed="statusFilter === key"
        :title="SUBMISSION_STATUS_META[key].description"
        @click="statusFilter = statusFilter === key ? '' : key"
      >
        <span class="flex items-center gap-1.5 text-[0.75rem] font-bold text-[#667768]">
          <i :class="SUBMISSION_STATUS_META[key].icon" aria-hidden="true"></i>
          {{ SUBMISSION_STATUS_META[key].label }}
        </span>
        <span class="text-[1.15rem] font-extrabold text-[#122815]">{{ counts[key] ?? 0 }}</span>
      </button>
    </div>

    <!-- Filter Bar -->
    <div class="bg-white rounded-xl border border-[#e2ece3] p-4 flex flex-col sm:flex-row gap-3">
      <input
        type="text"
        v-model="search"
        placeholder="Tìm theo họ tên, số điện thoại, địa chỉ, tiêu đề biểu mẫu..."
        class="flex-1 px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15"
      />
      <select
        v-model="viewedFilter"
        aria-label="Lọc theo lượt xem"
        class="px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15"
      >
        <option value="">Tất cả đơn</option>
        <option value="no">Chưa ai xem</option>
        <option value="yes">Đã có người xem</option>
      </select>
    </div>

    <!-- Bulk action bar -->
    <AdminBulkActionBar
      v-if="selection.count.value"
      :count="selection.count.value"
      :busy="bulk.busy.value"
      noun="đơn đăng ký"
      @clear="selection.clear()"
    >
      <button
        v-for="key in bulkStatusChoices"
        :key="key"
        type="button"
        class="rounded-lg border px-3 py-2 text-sm font-bold"
        :class="SUBMISSION_STATUS_META[key].badgeClass"
        @click="bulkStatus(key)"
      >
        {{ SUBMISSION_STATUS_META[key].label }}
      </button>
      <button type="button" class="rounded-lg bg-[#d12420] px-3 py-2 text-sm font-bold text-white hover:bg-[#b01f1b]" @click="bulkDelete">Xóa</button>
    </AdminBulkActionBar>

    <!-- Table Card -->
    <div class="bg-white rounded-xl border border-[#e2ece3] overflow-hidden">
      <!-- Loading -->
      <div v-if="loading" role="status" aria-busy="true" class="p-6">
        <span class="sr-only">Đang tải danh sách đơn đăng ký</span>
        <div class="flex flex-col gap-3 animate-pulse motion-reduce:animate-none">
          <div v-for="n in 6" :key="n" class="flex gap-3">
            <div v-for="c in 8" :key="c" class="h-10 bg-[#EEF2EC] rounded flex-1" aria-hidden="true"></div>
          </div>
        </div>
      </div>

      <!-- Error -->
      <div v-else-if="error" role="alert" class="px-6 py-10 text-center text-[#B04A4A] text-[0.95rem]">
        <i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>
        {{ error }} Vui lòng <button type="button" class="text-[#4A6741] font-bold underline" @click="fetchSubmissions()">thử lại</button>.
      </div>

      <!-- Mobile Card View -->
      <div v-else class="md:hidden divide-y divide-[#eef2ee]">
        <div
          v-for="s in filteredSubmissions"
          :key="'m-'+s.id"
          class="p-4"
          :class="selection.isSelected(Number(s.id)) ? 'bg-[#f0f7f1]' : ''"
          @click="openId = Number(s.id)"
        >
          <div class="flex items-center justify-between mb-1">
            <span class="flex min-w-0 items-center gap-2">
              <!-- .stop: the whole card opens the detail modal, and ticking a box
                   must not also open it. -->
              <input
                type="checkbox"
                class="h-4 w-4 shrink-0 accent-[#2c6e33]"
                :checked="selection.isSelected(Number(s.id))"
                :aria-label="`Chọn đơn của ${s.fullName || 'người gửi không tên'}`"
                @click.stop
                @change="selection.toggle(Number(s.id))"
              />
              <span class="truncate font-bold text-[#122815] text-[0.9rem]">{{ s.fullName || 'Không tên' }}</span>
            </span>
            <span class="text-[0.72rem] text-[#667768]">{{ fmtDate(s.createdAt) }}</span>
          </div>
          <div class="flex flex-wrap items-center gap-2 text-[0.8rem] text-[#445546]">
            <span
              class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.7rem] font-bold"
              :class="SUBMISSION_STATUS_META[statusOf(s)].badgeClass"
            >
              <i :class="SUBMISSION_STATUS_META[statusOf(s)].icon" aria-hidden="true"></i>
              {{ SUBMISSION_STATUS_META[statusOf(s)].label }}
            </span>
            <span v-if="!s.firstViewedAt" class="text-[0.7rem] font-bold text-[#8a5a12]">Chưa ai xem</span>
            <span v-if="s.phone"><i class="fa-solid fa-phone text-[0.65rem] text-[#667768]"></i> {{ s.phone }}</span>
            <span v-if="s.address" class="truncate max-w-[180px]"><i class="fa-solid fa-location-dot text-[0.65rem] text-[#667768]"></i> {{ s.address }}</span>
          </div>
          <p v-if="s.formTitle" class="text-[0.75rem] text-[#2c6e33] font-medium m-0 mt-1">{{ s.formTitle }}</p>
        </div>
        <div v-if="filteredSubmissions.length === 0" class="p-8 text-center text-[#667768] text-sm">Không có đơn đăng ký nào.</div>
      </div>

      <!-- Desktop Table View -->
      <!-- Not chained with v-else: the mobile card view above owns that slot, so
           both views need the loading and error conditions spelled out. Omitting
           !error renders an empty table underneath the alert, which reads as
           "loaded, found nothing" — the exact confusion the error branch exists
           to prevent. -->
      <div v-if="!loading && !error" class="hidden md:block overflow-x-auto">
        <table class="w-full border-collapse text-[0.88rem] text-left">
          <thead>
            <tr>
              <th class="bg-[#f8faf8] w-10 px-4 py-3 border-b border-[#e2ece3]">
                <input
                  type="checkbox"
                  class="h-4 w-4 accent-[#2c6e33]"
                  :checked="selection.allSelected(visibleIds)"
                  :indeterminate="selection.someSelected(visibleIds)"
                  aria-label="Chọn tất cả đơn đăng ký đang hiển thị"
                  @change="selection.toggleAll(visibleIds)"
                />
              </th>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">ID</th>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">Họ và tên</th>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">Số điện thoại</th>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">Trạng thái</th>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">Biểu mẫu</th>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">Ngày gửi</th>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="s in filteredSubmissions"
              :key="s.id"
              class="hover:bg-[#fafcfa]"
              :class="selection.isSelected(Number(s.id)) ? 'bg-[#f0f7f1]' : ''"
            >
              <td class="px-4 py-3.5 border-b border-[#eef2ee]">
                <input
                  type="checkbox"
                  class="h-4 w-4 accent-[#2c6e33]"
                  :checked="selection.isSelected(Number(s.id))"
                  :aria-label="`Chọn đơn của ${s.fullName || 'người gửi không tên'}`"
                  @change="selection.toggle(Number(s.id))"
                />
              </td>
              <td class="px-4 py-3.5 border-b border-[#eef2ee] text-[#667768]">#{{ s.id }}</td>
              <td class="px-4 py-3.5 border-b border-[#eef2ee] font-bold text-[#122815]">
                {{ s.fullName || '—' }}
                <!-- "Chưa ai xem" là một câu hỏi KHÁC với trạng thái `new`: một đơn
                     có thể đã được đọc mà chưa ai bấm đổi gì, và một đơn đang "Đang
                     xử lý" thì chắc chắn đã có người xem. Câu cán bộ trực cần hỏi
                     đầu giờ là câu thứ nhất. -->
                <span v-if="!s.firstViewedAt" class="ml-1.5 rounded bg-[#fdf3e2] px-1.5 py-0.5 text-[0.68rem] font-bold text-[#8a5a12]">chưa xem</span>
              </td>
              <td class="px-4 py-3.5 border-b border-[#eef2ee]"><code class="bg-[#f4f7f4] px-1.5 py-0.5 rounded text-xs">{{ s.phone || '—' }}</code></td>
              <td class="px-4 py-3.5 border-b border-[#eef2ee]">
                <span
                  class="inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[0.72rem] font-bold"
                  :class="SUBMISSION_STATUS_META[statusOf(s)].badgeClass"
                >
                  <i :class="SUBMISSION_STATUS_META[statusOf(s)].icon" aria-hidden="true"></i>
                  {{ SUBMISSION_STATUS_META[statusOf(s)].label }}
                </span>
              </td>
              <td class="px-4 py-3.5 border-b border-[#eef2ee] text-[#2c3e2e]">{{ s.formTitle || '—' }}</td>
              <td class="px-4 py-3.5 border-b border-[#eef2ee] text-[#667768] text-[0.82rem] whitespace-nowrap">
                {{ fmtDate(s.createdAt) }}
              </td>
              <td class="px-4 py-3.5 border-b border-[#eef2ee]">
                <button
                  class="inline-flex items-center gap-1.5 bg-[#f0f7f1] text-[#2c6e33] border border-[#8ed694] px-2.5 py-1.5 rounded-md text-[0.78rem] font-bold cursor-pointer hover:bg-[#e4f2e5] transition-colors"
                  @click="openId = Number(s.id)"
                >
                  <i class="fa-solid fa-eye"></i> Xem & xử lý
                </button>
              </td>
            </tr>
            <tr v-if="filteredSubmissions.length === 0">
              <td colspan="8" class="px-4 py-8 text-center text-[#667768] text-sm">Không có đơn đăng ký nào.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Detail + workflow modal. Tự tải nhật ký xử lý; `changed` để bảng và ô tổng
         cập nhật theo — nếu không thì huy hiệu trên bảng giữ giá trị cũ và cùng một
         hồ sơ hiện hai trạng thái khác nhau trên một màn hình. -->
    <AdminSubmissionDetailModal
      :id="openId"
      @close="openId = null"
      @changed="fetchSubmissions()"
    />
  </div>
</template>
