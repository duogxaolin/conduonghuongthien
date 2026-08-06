<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

interface SessionRow {
  id: string
  ip: string | null
  browser: string
  detectedPhone: string | null
  detectedName: string | null
  messageCount: number
  startedAt: string
  lastMessageAt: string
}

const rows = ref<SessionRow[]>([])
const loading = ref(true)
// A persistent error branch, not just a toast: a failed fetch and an empty
// table look identical otherwise, and a cán bộ would read "chưa có phiên nào"
// as fact.
const loadError = ref('')

const page = ref(1)
const pageSize = 25
const total = ref(0)
const totalPages = ref(1)

const from = ref('')
const to = ref('')
const hasContact = ref<'' | 'yes' | 'no'>('')

const fetchSessions = async () => {
  loading.value = true
  loadError.value = ''
  try {
    const res = await $fetch<{
      ok: boolean; total: number; totalPages: number; items: SessionRow[]
    }>('/api/admin/chatbot/sessions', {
      query: {
        page: page.value,
        pageSize,
        ...(from.value ? { from: from.value } : {}),
        ...(to.value ? { to: to.value } : {}),
        ...(hasContact.value ? { hasContact: hasContact.value } : {}),
      },
    })
    if (res.ok) {
      rows.value = res.items
      total.value = res.total
      totalPages.value = res.totalPages
    }
  } catch (err: unknown) {
    loadError.value = errorMessage(err, 'Không thể tải danh sách phiên trò chuyện.')
  } finally {
    loading.value = false
  }
}

const applyFilters = () => { page.value = 1; fetchSessions() }
const resetFilters = () => { from.value = ''; to.value = ''; hasContact.value = ''; applyFilters() }

const goPage = (next: number) => {
  if (next < 1 || next > totalPages.value || next === page.value) return
  page.value = next
  fetchSessions()
}

const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleString('vi-VN') : '—')

onMounted(() => { fetchSessions() })
</script>

<template>
  <div class="flex flex-col gap-5">
    <div>
      <h1 class="m-0 text-[1.3rem] font-extrabold text-[#122815]">Phiên trò chuyện với Trợ lý</h1>
      <p class="mt-1 mb-0 text-[0.85rem] text-[#667768]">
        Nội dung khách đã hỏi Trợ lý AI, kèm địa chỉ IP, trình duyệt và thông tin liên hệ nếu khách có để lại.
      </p>
    </div>

    <!-- Filters -->
    <div class="flex flex-col gap-3 rounded-xl border border-[#e2ece3] bg-white p-4 sm:flex-row sm:items-end">
      <label class="flex flex-1 flex-col gap-1">
        <span class="text-[0.78rem] font-bold text-[#667768]">Từ ngày</span>
        <input v-model="from" type="date" class="rounded-lg border border-[#c8d6c9] px-3 py-2 text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15" />
      </label>
      <label class="flex flex-1 flex-col gap-1">
        <span class="text-[0.78rem] font-bold text-[#667768]">Đến ngày</span>
        <input v-model="to" type="date" class="rounded-lg border border-[#c8d6c9] px-3 py-2 text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15" />
      </label>
      <label class="flex flex-1 flex-col gap-1">
        <span class="text-[0.78rem] font-bold text-[#667768]">Thông tin liên hệ</span>
        <select v-model="hasContact" class="rounded-lg border border-[#c8d6c9] px-3 py-2 text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15">
          <option value="">Tất cả</option>
          <option value="yes">Đã có số điện thoại</option>
          <option value="no">Chưa có</option>
        </select>
      </label>
      <div class="flex gap-2">
        <button type="button" class="rounded-lg bg-[#2c6e33] px-4 py-2 text-sm font-bold text-white hover:bg-[#245a2a]" @click="applyFilters">Lọc</button>
        <button type="button" class="rounded-lg border border-[#c8d6c9] px-4 py-2 text-sm font-bold text-[#445546] hover:bg-[#f4f7f4]" @click="resetFilters">Xóa lọc</button>
      </div>
    </div>

    <SkeletonTable v-if="loading" label="Đang tải danh sách phiên trò chuyện" :rows="6" :cols="6" />

    <div v-else-if="loadError" role="alert" class="rounded-xl border border-dashed border-[#e2a0a0] bg-white px-6 py-10 text-center text-[0.9rem] text-[#b04a4a]">
      <i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>
      {{ loadError }}
      <button type="button" class="ml-1 font-bold text-[#2c6e33] underline" @click="fetchSessions()">Thử lại</button>
    </div>

    <div v-else-if="rows.length === 0" class="rounded-xl border border-dashed border-[#e2ece3] bg-white px-6 py-10 text-center text-[0.9rem] text-[#667768]">
      Chưa có phiên trò chuyện nào khớp điều kiện đang chọn.
    </div>

    <template v-else>
      <!-- Mobile cards -->
      <div class="divide-y divide-[#eef2ee] overflow-hidden rounded-xl border border-[#e2ece3] bg-white md:hidden">
        <nuxt-link
          v-for="s in rows"
          :key="'m-' + s.id"
          :to="`/admin/chatbot/sessions/${s.id}`"
          class="block p-4 hover:bg-[#fafcfa]"
        >
          <div class="mb-1 flex items-center justify-between gap-2">
            <span class="truncate text-[0.9rem] font-bold text-[#122815]">
              {{ s.detectedName || s.ip || 'Khách ẩn danh' }}
            </span>
            <span class="shrink-0 text-[0.72rem] text-[#667768]">{{ fmtDate(s.lastMessageAt) }}</span>
          </div>
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8rem] text-[#445546]">
            <span><i class="fa-solid fa-comments text-[0.65rem] text-[#667768]" aria-hidden="true"></i> {{ s.messageCount }} tin nhắn</span>
            <span class="truncate"><i class="fa-solid fa-desktop text-[0.65rem] text-[#667768]" aria-hidden="true"></i> {{ s.browser }}</span>
            <span v-if="s.detectedPhone" class="font-bold text-[#2c6e33]">
              <i class="fa-solid fa-phone text-[0.65rem]" aria-hidden="true"></i> {{ s.detectedPhone }}
            </span>
          </div>
        </nuxt-link>
      </div>

      <!-- Desktop table -->
      <div class="hidden overflow-hidden rounded-xl border border-[#e2ece3] bg-white md:block">
        <div class="overflow-x-auto">
          <table class="w-full border-collapse text-left text-[0.88rem]">
            <thead>
              <tr>
                <th class="whitespace-nowrap border-b border-[#e2ece3] bg-[#f8faf8] px-4 py-3 font-bold text-[#667768]">Địa chỉ IP</th>
                <th class="whitespace-nowrap border-b border-[#e2ece3] bg-[#f8faf8] px-4 py-3 font-bold text-[#667768]">Trình duyệt</th>
                <th class="whitespace-nowrap border-b border-[#e2ece3] bg-[#f8faf8] px-4 py-3 font-bold text-[#667768]">Bắt đầu</th>
                <th class="whitespace-nowrap border-b border-[#e2ece3] bg-[#f8faf8] px-4 py-3 font-bold text-[#667768]">Tin nhắn cuối</th>
                <th class="whitespace-nowrap border-b border-[#e2ece3] bg-[#f8faf8] px-4 py-3 font-bold text-[#667768]">Số tin</th>
                <th class="whitespace-nowrap border-b border-[#e2ece3] bg-[#f8faf8] px-4 py-3 font-bold text-[#667768]">Liên hệ đã nêu</th>
                <th class="whitespace-nowrap border-b border-[#e2ece3] bg-[#f8faf8] px-4 py-3 font-bold text-[#667768]">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in rows" :key="s.id" class="hover:bg-[#fafcfa]">
                <td class="border-b border-[#eef2ee] px-4 py-3.5">
                  <code class="rounded bg-[#f4f7f4] px-1.5 py-0.5 text-xs">{{ s.ip || '—' }}</code>
                </td>
                <td class="border-b border-[#eef2ee] px-4 py-3.5 text-[#2c3e2e]">{{ s.browser }}</td>
                <td class="whitespace-nowrap border-b border-[#eef2ee] px-4 py-3.5 text-[#667768]">{{ fmtDate(s.startedAt) }}</td>
                <td class="whitespace-nowrap border-b border-[#eef2ee] px-4 py-3.5 text-[#667768]">{{ fmtDate(s.lastMessageAt) }}</td>
                <td class="border-b border-[#eef2ee] px-4 py-3.5 text-[#2c3e2e]">{{ s.messageCount }}</td>
                <td class="border-b border-[#eef2ee] px-4 py-3.5">
                  <span v-if="s.detectedPhone || s.detectedName" class="text-[#2c6e33]">
                    <span v-if="s.detectedName" class="font-bold">{{ s.detectedName }}</span>
                    <span v-if="s.detectedName && s.detectedPhone"> · </span>
                    <span v-if="s.detectedPhone">{{ s.detectedPhone }}</span>
                  </span>
                  <span v-else class="text-[#98a599]">—</span>
                </td>
                <td class="whitespace-nowrap border-b border-[#eef2ee] px-4 py-3.5">
                  <nuxt-link :to="`/admin/chatbot/sessions/${s.id}`" class="font-bold text-[#2c6e33] hover:underline">
                    Xem nội dung
                  </nuxt-link>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Pagination -->
      <div class="flex flex-col items-center justify-between gap-3 sm:flex-row">
        <p class="m-0 text-[0.8rem] text-[#667768]">
          Tổng {{ total }} phiên · Trang {{ page }}/{{ totalPages }}
        </p>
        <div class="flex gap-2">
          <button
            type="button"
            class="rounded-lg border border-[#c8d6c9] px-3 py-1.5 text-sm font-bold text-[#445546] hover:bg-[#f4f7f4] disabled:opacity-40 disabled:hover:bg-transparent"
            :disabled="page <= 1"
            @click="goPage(page - 1)"
          >Trước</button>
          <button
            type="button"
            class="rounded-lg border border-[#c8d6c9] px-3 py-1.5 text-sm font-bold text-[#445546] hover:bg-[#f4f7f4] disabled:opacity-40 disabled:hover:bg-transparent"
            :disabled="page >= totalPages"
            @click="goPage(page + 1)"
          >Sau</button>
        </div>
      </div>
    </template>
  </div>
</template>
