<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: 'admin-auth'
})

const submissions = ref<any[]>([])
const loading = ref(true)
const search = ref('')
const selectedSub = ref<any>(null)
const toast = useToast()

const fetchSubmissions = async () => {
  loading.value = true
  try {
    const res = await $fetch('/api/admin/submissions')
    if (res.ok) submissions.value = res.submissions
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Lỗi tải danh sách đơn đăng ký')
  } finally {
    loading.value = false
  }
}

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

// Free-form answers whose fields weren't mapped to a fixed column. Stored as
// JSON [{label,value}]; may be null on legacy rows or a stringified JSON.
const extraAnswers = (sub: any): Array<{ label: string; value: string }> => {
  const raw = sub?.answers
  if (!raw) return []
  const arr = typeof raw === 'string' ? (() => { try { return JSON.parse(raw) } catch { return [] } })() : raw
  return Array.isArray(arr) ? arr.filter((a: any) => a && (a.label || a.value)) : []
}

const fmtDate = (v: any) => (v ? new Date(v).toLocaleString('vi-VN') : '—')

// ─── Bulk selection ───────────────────────────────────────────────────────────
const selection = useBulkSelection()
const bulk = useBulkAction(selection)

// Search filters client-side here, so the selectable set is the filtered list —
// a row the operator cannot currently see must not be in the lot.
const visibleIds = computed(() => filteredSubmissions.value.map((s: any) => Number(s.id)))

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

onMounted(() => { fetchSubmissions() })
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- Page Header -->
    <div>
      <h1 class="text-[1.3rem] font-extrabold text-[#122815] m-0">Danh sách Đơn đăng ký Hỗ trợ</h1>
      <p class="text-[0.85rem] text-[#667768] mt-1 mb-0">Tiếp nhận và xử lý thông tin từ người dân đăng ký tư vấn tái hòa nhập cộng đồng</p>
    </div>

    <!-- Filter Bar -->
    <div class="bg-white rounded-xl border border-[#e2ece3] p-4 flex flex-col sm:flex-row gap-3">
      <input
        type="text"
        v-model="search"
        placeholder="Tìm theo họ tên, số điện thoại, địa chỉ, tiêu đề biểu mẫu..."
        class="flex-1 px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15"
      />
    </div>

    <!-- Bulk action bar -->
    <AdminBulkActionBar
      v-if="selection.count.value"
      :count="selection.count.value"
      :busy="bulk.busy.value"
      noun="đơn đăng ký"
      @clear="selection.clear()"
    >
      <button type="button" class="rounded-lg bg-[#d12420] px-3 py-2 text-sm font-bold text-white hover:bg-[#b01f1b]" @click="bulkDelete">Xóa</button>
    </AdminBulkActionBar>

    <!-- Table Card -->
    <div class="bg-white rounded-xl border border-[#e2ece3] overflow-hidden">
      <SkeletonTable v-if="loading" label="Đang tải danh sách đơn đăng ký" :rows="6" :cols="8" />

      <!-- Mobile Card View -->
      <div v-else class="md:hidden divide-y divide-[#eef2ee]">
        <div
          v-for="s in filteredSubmissions"
          :key="'m-'+s.id"
          class="p-4"
          :class="selection.isSelected(Number(s.id)) ? 'bg-[#f0f7f1]' : ''"
          @click="selectedSub = s"
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
            <span v-if="s.phone"><i class="fa-solid fa-phone text-[0.65rem] text-[#667768]"></i> {{ s.phone }}</span>
            <span v-if="s.address" class="truncate max-w-[180px]"><i class="fa-solid fa-location-dot text-[0.65rem] text-[#667768]"></i> {{ s.address }}</span>
          </div>
          <p v-if="s.formTitle" class="text-[0.75rem] text-[#2c6e33] font-medium m-0 mt-1">{{ s.formTitle }}</p>
        </div>
        <div v-if="filteredSubmissions.length === 0" class="p-8 text-center text-[#667768] text-sm">Không có đơn đăng ký nào.</div>
      </div>

      <!-- Desktop Table View -->
      <div v-if="!loading" class="hidden md:block overflow-x-auto">
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
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">Địa chỉ</th>
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
              <td class="px-4 py-3.5 border-b border-[#eef2ee] font-bold text-[#122815]">{{ s.fullName || '—' }}</td>
              <td class="px-4 py-3.5 border-b border-[#eef2ee]"><code class="bg-[#f4f7f4] px-1.5 py-0.5 rounded text-xs">{{ s.phone || '—' }}</code></td>
              <td class="px-4 py-3.5 border-b border-[#eef2ee] text-[#2c3e2e]">{{ s.address || '—' }}</td>
              <td class="px-4 py-3.5 border-b border-[#eef2ee] text-[#2c3e2e]">{{ s.formTitle || '—' }}</td>
              <td class="px-4 py-3.5 border-b border-[#eef2ee] text-[#667768] text-[0.82rem] whitespace-nowrap">
                {{ fmtDate(s.createdAt) }}
              </td>
              <td class="px-4 py-3.5 border-b border-[#eef2ee]">
                <button
                  class="inline-flex items-center gap-1.5 bg-[#f0f7f1] text-[#2c6e33] border border-[#8ed694] px-2.5 py-1.5 rounded-md text-[0.78rem] font-bold cursor-pointer hover:bg-[#e4f2e5] transition-colors"
                  @click="selectedSub = s"
                >
                  <i class="fa-solid fa-eye"></i> Xem chi tiết
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Detail Modal -->
    <div v-if="selectedSub" class="fixed inset-0 bg-black/50 flex items-center justify-center z-[2000] p-4" @click.self="selectedSub = null">
      <div class="bg-white rounded-2xl p-7 w-full max-w-[520px] max-h-[90vh] overflow-y-auto">
        <h3 class="text-[1.15rem] font-extrabold text-[#122815] m-0 mb-1">📋 Chi tiết Đơn đăng ký #{{ selectedSub.id }}</h3>
        <p class="text-[0.82rem] text-[#667768] m-0 mb-1">Gửi lúc: {{ fmtDate(selectedSub.createdAt) }}</p>
        <p v-if="selectedSub.formTitle" class="text-[0.85rem] text-[#2c6e33] font-bold m-0 mb-5">Biểu mẫu: {{ selectedSub.formTitle }}</p>
        <div v-else class="mb-5"></div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div v-if="selectedSub.fullName" class="flex flex-col gap-1">
            <span class="text-[0.78rem] text-[#667768] font-bold">Họ và tên:</span>
            <strong class="text-[#122815]">{{ selectedSub.fullName }}</strong>
          </div>
          <div v-if="selectedSub.phone" class="flex flex-col gap-1">
            <span class="text-[0.78rem] text-[#667768] font-bold">Số điện thoại:</span>
            <code class="bg-[#f4f7f4] px-2 py-1 rounded text-sm self-start">{{ selectedSub.phone }}</code>
          </div>
          <div v-if="selectedSub.email" class="flex flex-col gap-1">
            <span class="text-[0.78rem] text-[#667768] font-bold">Email:</span>
            <span>{{ selectedSub.email }}</span>
          </div>
          <div v-if="selectedSub.address" class="flex flex-col gap-1 sm:col-span-2">
            <span class="text-[0.78rem] text-[#667768] font-bold">Địa chỉ:</span>
            <span>{{ selectedSub.address }}</span>
          </div>
          <div v-if="selectedSub.message" class="flex flex-col gap-1 sm:col-span-2">
            <span class="text-[0.78rem] text-[#667768] font-bold">Nội dung yêu cầu / Hoàn cảnh:</span>
            <div class="bg-[#f8faf8] border border-[#e2ece3] px-3 py-3 rounded-lg text-[0.9rem] leading-relaxed whitespace-pre-wrap">{{ selectedSub.message }}</div>
          </div>
          <!-- Free-form answers (fields not mapped to a fixed column) -->
          <div v-for="(a, i) in extraAnswers(selectedSub)" :key="i" class="flex flex-col gap-1 sm:col-span-2">
            <span class="text-[0.78rem] text-[#667768] font-bold">{{ a.label }}:</span>
            <span class="whitespace-pre-wrap">{{ a.value || '—' }}</span>
          </div>
        </div>

        <div class="flex justify-end gap-3 mt-6">
          <button class="bg-[#f0f0f0] border-0 px-4 py-2.5 rounded-lg cursor-pointer font-medium" @click="selectedSub = null">Đóng</button>
          <a
            :href="`tel:${selectedSub.phone}`"
            class="inline-flex items-center gap-2 bg-[#1e4620] hover:bg-[#2c6e33] text-white font-bold px-4 py-2.5 rounded-lg no-underline transition-colors"
          >
            <i class="fa-solid fa-phone"></i> Gọi Điện Tư Vấn
          </a>
        </div>
      </div>
    </div>
  </div>
</template>
