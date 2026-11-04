<script setup lang="ts">
import type { AdminAnswerCacheListResponse, AdminAnswerCacheDeleteResponse } from '~/types/admin-chatbot-api'
definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

interface CacheRow {
  cacheKey: string
  question: string
  kind: string
  hits: number
  createdAt: string
  lastUsedAt: string
  expiresAt: string
}

type CacheFilters = { q: string }

const pageSize = 25

// List state, stale-request guard and paging: dùng chung `useAdminList` như trang
// "Phiên trò chuyện" — cùng một hợp đồng tải/lỗi/rỗng, không dựng bản thứ hai.
const list = useAdminList<CacheRow, CacheFilters>({
  filters: { q: '' },
  errorFallback: 'Không thể tải danh sách câu trả lời đã lưu.',
  load: async ({ page, filters, signal }) => {
    const res = await adminFetch<AdminAnswerCacheListResponse>('/api/admin/chatbot/answer-cache', {
      query: { page, pageSize, ...(filters.q ? { q: filters.q } : {}) },
      signal,
    })
    if (!res?.ok) return null
    return { items: res.items, total: res.total, totalPages: res.totalPages, page: res.page }
  },
})
const { items: rows, page, total, totalPages, loading, filters, applyFilters, goToPage, resetFilters } = list
const error = computed(() => list.error.value)
const reload = list.reload

const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleString('vi-VN') : '—')

const toast = useToast()
const { confirm } = useConfirm()
const { hasPermission } = useAdminAuth()
const canDelete = computed(() => hasPermission('chatbot_knowledge', 'delete'))

const selection = useBulkSelection<string>()
const listShown = computed(() => !loading.value && !error.value)
const visibleIds = computed(() => (listShown.value ? rows.value.map(r => r.cacheKey) : []))
watch(visibleIds, ids => selection.keepOnly(ids))
const deleting = ref(false)
const clearing = ref(false)

async function bulkDelete() {
  const keys = selection.ids.value
  if (!canDelete.value || !listShown.value || keys.length === 0 || deleting.value) return
  if (!await confirm({
    title: 'Xoá câu trả lời đã lưu',
    message: `Xoá ${keys.length} câu trả lời đã lưu? Lượt hỏi sau sẽ phải gọi lại mô hình AI và trả lời chậm như lần đầu. Kho kiến thức và lịch sử trò chuyện không bị ảnh hưởng.`,
    confirmLabel: 'Xoá',
    danger: true,
  })) return

  deleting.value = true
  try {
    const res = await adminFetch<AdminAnswerCacheDeleteResponse>('/api/admin/chatbot/answer-cache/bulk-delete', {
      method: 'POST',
      body: { keys },
    })
    selection.remove(keys)
    const missing = Math.max(0, keys.length - res.deleted)
    if (missing === 0) toast.success(`Đã xoá ${res.deleted} câu trả lời đã lưu.`)
    else if (res.deleted === 0) toast.warning(`Không có câu nào bị xoá: ${missing} mục đã chọn không còn tồn tại.`)
    else toast.warning(`Đã xoá ${res.deleted} câu; ${missing} mục không còn tồn tại.`)
    await reload()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể xoá các câu trả lời đã chọn.'))
  } finally {
    deleting.value = false
  }
}

async function deleteOne(row: CacheRow) {
  if (!canDelete.value || deleting.value) return
  if (!await confirm({
    title: 'Xoá câu trả lời đã lưu',
    message: `Xoá bản đã lưu cho câu "${row.question.slice(0, 120)}"? Lượt hỏi sau sẽ gọi lại mô hình AI.`,
    confirmLabel: 'Xoá',
    danger: true,
  })) return
  deleting.value = true
  try {
    await adminFetch<AdminAnswerCacheDeleteResponse>(`/api/admin/chatbot/answer-cache/${row.cacheKey}`, { method: 'DELETE' })
    toast.success('Đã xoá câu trả lời đã lưu.')
    await reload()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể xoá câu trả lời này.'))
  } finally {
    deleting.value = false
  }
}

async function clearAll() {
  if (!canDelete.value || clearing.value) return
  if (!await confirm({
    title: 'Xoá toàn bộ câu trả lời đã lưu',
    message: `Xoá TẤT CẢ ${total.value} câu trả lời đã lưu? Sau đó mọi câu hỏi đều phải gọi lại mô hình AI (chậm hơn và tốn phí cho tới khi bộ đệm đầy lại). Kho kiến thức và lịch sử trò chuyện không bị ảnh hưởng.`,
    confirmLabel: 'Xoá toàn bộ',
    danger: true,
  })) return

  clearing.value = true
  try {
    const res = await adminFetch<AdminAnswerCacheDeleteResponse>('/api/admin/chatbot/answer-cache/clear-all', { method: 'POST' })
    selection.clear()
    toast.success(`Đã xoá ${res.deleted} câu trả lời đã lưu.`)
    await reload()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể xoá toàn bộ bộ đệm.'))
  } finally {
    clearing.value = false
  }
}

onMounted(reload)
</script>

<template>
  <div class="flex flex-col gap-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="m-0 text-[1.3rem] font-extrabold text-brand-950">Câu trả lời đã lưu</h1>
        <p class="mt-1 mb-0 max-w-3xl text-[0.85rem] text-ink-muted">
          Những câu mô hình AI đã trả lời và đang được dùng lại cho các lượt hỏi giống hệt — trả về ngay thay vì gọi lại mô hình.
          Bộ đệm tự vô hiệu khi kho kiến thức, câu trả lời thường nhật, cấu hình AI hoặc mô hình thay đổi; mỗi mục cũng tự hết hạn sau 30 ngày.
        </p>
      </div>
      <button
        v-if="canDelete"
        type="button"
        class="rounded-lg border border-danger-soft/45 bg-white px-4 py-2 text-sm font-bold text-danger-soft hover:bg-danger-bg disabled:cursor-not-allowed disabled:opacity-60"
        :disabled="clearing || total === 0"
        @click="clearAll"
      >
        <i class="fa-solid fa-trash-can mr-1 text-[0.75rem]" aria-hidden="true"></i>
        {{ clearing ? 'Đang xoá…' : 'Xoá toàn bộ' }}
      </button>
    </div>

    <div class="flex flex-col gap-3 rounded-xl border border-line bg-white p-4 sm:flex-row sm:items-end">
      <label class="flex flex-1 flex-col gap-1">
        <span class="text-[0.78rem] font-bold text-ink-muted">Tìm theo câu hỏi</span>
        <input
          v-model="filters.q"
          type="search"
          maxlength="200"
          placeholder="Ví dụ: xóa án tích"
          class="rounded-lg border border-line-strong px-3 py-2 text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15"
          @keyup.enter="applyFilters"
        />
      </label>
      <div class="flex gap-2">
        <button type="button" class="rounded-lg bg-brand-700 px-4 py-2 text-sm font-bold text-white hover:bg-brand-900" @click="applyFilters">Tìm</button>
        <button type="button" class="rounded-lg border border-line-strong px-4 py-2 text-sm font-bold text-ink-secondary hover:bg-surface" @click="resetFilters">Xoá lọc</button>
      </div>
    </div>

    <AdminBulkActionBar
      v-if="canDelete && listShown && selection.count.value"
      :count="selection.count.value"
      :busy="deleting"
      noun="câu trả lời đã lưu"
      @clear="selection.clear()"
    >
      <button
        type="button"
        class="rounded-lg bg-danger px-3 py-2 text-sm font-bold text-white hover:bg-danger/90 focus:outline-none focus:ring-2 focus:ring-brand-700 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        :disabled="deleting"
        @click="bulkDelete"
      >
        <i class="fa-solid fa-trash-can mr-1 text-[0.75rem]" aria-hidden="true"></i>
        {{ deleting ? 'Đang xoá…' : 'Xoá' }}
      </button>
    </AdminBulkActionBar>

    <SkeletonTable v-if="loading" label="Đang tải danh sách câu trả lời đã lưu" :rows="6" :cols="5" />

    <div v-else-if="error" role="alert" class="rounded-xl border border-dashed border-danger-soft/45 bg-white px-6 py-10 text-center text-[0.9rem] text-danger-soft">
      <i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>
      {{ error }}
      <button type="button" class="ml-1 font-bold text-brand-700 underline" @click="reload()">Thử lại</button>
    </div>

    <div v-else-if="rows.length === 0" class="rounded-xl border border-dashed border-line bg-white px-6 py-10 text-center text-[0.9rem] text-ink-muted">
      Chưa có câu trả lời nào được lưu. Bộ đệm sẽ đầy dần khi người dân đặt câu hỏi cần tới AI.
    </div>

    <template v-else>
      <div class="hidden overflow-hidden rounded-xl border border-line bg-white md:block">
        <div class="overflow-x-auto">
          <table class="w-full border-collapse text-left text-[0.88rem]">
            <thead>
              <tr>
                <th v-if="canDelete" class="w-10 border-b border-line bg-surface px-4 py-3">
                  <input
                    type="checkbox"
                    class="h-4 w-4 accent-brand-700"
                    :checked="selection.allSelected(visibleIds)"
                    :indeterminate="selection.someSelected(visibleIds)"
                    aria-label="Chọn tất cả câu trả lời đang hiển thị"
                    @change="selection.toggleAll(visibleIds)"
                  />
                </th>
                <th class="border-b border-line bg-surface px-4 py-3 font-bold text-ink-muted">Câu hỏi</th>
                <th class="whitespace-nowrap border-b border-line bg-surface px-4 py-3 font-bold text-ink-muted">Số lần dùng</th>
                <th class="whitespace-nowrap border-b border-line bg-surface px-4 py-3 font-bold text-ink-muted">Dùng gần nhất</th>
                <th class="whitespace-nowrap border-b border-line bg-surface px-4 py-3 font-bold text-ink-muted">Hết hạn</th>
                <th v-if="canDelete" class="whitespace-nowrap border-b border-line bg-surface px-4 py-3 font-bold text-ink-muted">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in rows" :key="r.cacheKey" class="hover:bg-surface" :class="selection.isSelected(r.cacheKey) ? 'bg-surface-tint' : ''">
                <td v-if="canDelete" class="border-b border-surface-tint px-4 py-3.5">
                  <input
                    type="checkbox"
                    class="h-4 w-4 accent-brand-700"
                    :checked="selection.isSelected(r.cacheKey)"
                    :aria-label="`Chọn câu ${r.question.slice(0, 60)}`"
                    @change="selection.toggle(r.cacheKey)"
                  />
                </td>
                <td class="max-w-[28rem] border-b border-surface-tint px-4 py-3.5">
                  <span class="line-clamp-2 font-semibold text-brand-950">{{ r.question }}</span>
                </td>
                <td class="whitespace-nowrap border-b border-surface-tint px-4 py-3.5 text-ink-secondary">{{ r.hits }}</td>
                <td class="whitespace-nowrap border-b border-surface-tint px-4 py-3.5 text-ink-secondary">{{ fmtDate(r.lastUsedAt) }}</td>
                <td class="whitespace-nowrap border-b border-surface-tint px-4 py-3.5 text-ink-secondary">{{ fmtDate(r.expiresAt) }}</td>
                <td v-if="canDelete" class="whitespace-nowrap border-b border-surface-tint px-4 py-3.5">
                  <button
                    type="button"
                    class="rounded-lg border border-danger-soft/45 px-3 py-1.5 text-[0.8rem] font-bold text-danger-soft hover:bg-danger-bg disabled:opacity-60"
                    :disabled="deleting"
                    @click="deleteOne(r)"
                  >
                    Xoá
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="divide-y divide-surface-tint overflow-hidden rounded-xl border border-line bg-white md:hidden">
        <div v-for="r in rows" :key="'m-' + r.cacheKey" class="flex items-start gap-3 px-4 py-4" :class="selection.isSelected(r.cacheKey) ? 'bg-surface-tint' : ''">
          <input
            v-if="canDelete"
            type="checkbox"
            class="mt-1 h-4 w-4 shrink-0 accent-brand-700"
            :checked="selection.isSelected(r.cacheKey)"
            :aria-label="`Chọn câu ${r.question.slice(0, 60)}`"
            @change="selection.toggle(r.cacheKey)"
          />
          <div class="min-w-0 flex-1">
            <p class="m-0 text-[0.9rem] font-bold text-brand-950">{{ r.question }}</p>
            <p class="m-0 mt-1 text-[0.78rem] text-ink-muted">
              {{ r.hits }} lần · dùng gần nhất {{ fmtDate(r.lastUsedAt) }}
            </p>
            <button
              v-if="canDelete"
              type="button"
              class="mt-2 rounded-lg border border-danger-soft/45 px-3 py-1.5 text-[0.78rem] font-bold text-danger-soft hover:bg-danger-bg disabled:opacity-60"
              :disabled="deleting"
              @click="deleteOne(r)"
            >
              Xoá
            </button>
          </div>
        </div>
      </div>

      <div v-if="totalPages > 1" class="flex items-center justify-center gap-3 text-sm">
        <button type="button" class="rounded-lg border border-line-strong px-3 py-1.5 font-bold disabled:opacity-50" :disabled="page <= 1" @click="goToPage(page - 1)">Trước</button>
        <span class="text-ink-muted">Trang {{ page }} / {{ totalPages }} · {{ total }} mục</span>
        <button type="button" class="rounded-lg border border-line-strong px-3 py-1.5 font-bold disabled:opacity-50" :disabled="page >= totalPages" @click="goToPage(page + 1)">Sau</button>
      </div>
    </template>
  </div>
</template>
