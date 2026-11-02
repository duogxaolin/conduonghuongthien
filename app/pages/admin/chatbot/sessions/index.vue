<script setup lang="ts">
import type { AdminChatSessionBulkDeleteResponse } from '~/types/admin-chatbot-api'
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

type SessionFilters = {
  /** `<input type="date">` values — Vietnam calendar days, `YYYY-MM-DD`; '' = no bound. */
  from: string
  to: string
  hasContact: '' | 'yes' | 'no'
}

/** `page` is the requested page echoed back — this endpoint does not clamp it. */
type SessionListResponse = { ok: boolean; page: number; total: number; totalPages: number; items: SessionRow[] }

const pageSize = 25

// List state, stale-request guard and paging: useAdminList (tests/admin-list.test.ts).
const list = useAdminList<SessionRow, SessionFilters>({
  filters: { from: '', to: '', hasContact: '' },
  // A persistent error branch, not just a toast: a failed fetch and an empty
  // table look identical otherwise, and a cán bộ would read "chưa có phiên nào"
  // as fact.
  errorFallback: 'Không thể tải danh sách phiên trò chuyện.',
  load: async ({ page, filters, signal }) => {
    const res = await adminFetch<SessionListResponse>('/api/admin/chatbot/sessions', {
      query: {
        page,
        pageSize,
        ...(filters.from ? { from: filters.from } : {}),
        ...(filters.to ? { to: filters.to } : {}),
        ...(filters.hasContact ? { hasContact: filters.hasContact } : {}),
      },
      signal,
    })
    if (!res?.ok) return null
    return { items: res.items, total: res.total, totalPages: res.totalPages, page: res.page }
  },
})
const { items: rows, page, total, totalPages, loading, filters, applyFilters, goToPage, resetFilters } = list
// The error branch and its retry are declared here, in the page, on purpose:
// tests/admin-error-retry-ui.test.ts reads this file's own source.
const error = computed(() => list.error.value)
const reload = list.reload

const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleString('vi-VN') : '—')

// ─── Xoá phiên theo yêu cầu của người dân ──────────────────────────────────────
// Both delete routes check `chatbot_knowledge.delete`: without it there is no
// checkbox, no action strip — a button that can only come back 403 is a trap.
const toast = useToast()
const { confirm } = useConfirm()
const { hasPermission } = useAdminAuth()
const canDelete = computed(() => hasPermission('chatbot_knowledge', 'delete'))

// A session id is a string (UUID), hence `<string>`. The selectable set is the page
// on screen; a page or filter change drops what is no longer visible.
const selection = useBulkSelection<string>()
const visibleIds = computed(() => rows.value.map(s => s.id))
watch(visibleIds, ids => selection.keepOnly(ids))
const deleting = ref(false)

/**
 * Not `useBulkAction`: this route answers `{ ok, deleted: <count> }`, not the
 * `runBulk` outcome (no per-id result — tests/admin-fetch-rollout-bulk-action.test.ts
 * names it as the route that must stay out of that composable). Every id sent is
 * gone afterwards — removed now, or already removed by another officer or the
 * retention purge — so the whole lot leaves the selection and the gap is reported.
 */
async function bulkDelete() {
  const ids = selection.ids.value
  if (!canDelete.value || ids.length === 0 || deleting.value) return
  if (!await confirm({
    title: 'Xóa phiên trò chuyện',
    message: `Xóa vĩnh viễn ${ids.length} phiên trò chuyện đã chọn cùng toàn bộ tin nhắn? Nội dung trò chuyện và thông tin liên hệ khách đã để lại sẽ bị xóa, không thể hoàn tác.`,
    confirmLabel: 'Xóa vĩnh viễn',
    danger: true,
  })) return

  deleting.value = true
  try {
    const res = await adminFetch<AdminChatSessionBulkDeleteResponse>('/api/admin/chatbot/sessions/bulk-delete', {
      method: 'POST',
      body: { ids },
    })
    selection.remove(ids)
    const missing = Math.max(0, ids.length - res.deleted)
    if (missing === 0) toast.success(`Đã xóa ${res.deleted} phiên trò chuyện.`)
    else if (res.deleted === 0) toast.warning(`Không có phiên nào bị xóa: ${missing} phiên đã chọn không còn tồn tại (có thể đã bị xóa trước đó).`)
    else toast.warning(`Đã xóa ${res.deleted} phiên trò chuyện; ${missing} phiên không còn tồn tại (có thể đã bị xóa trước đó).`)
    // useAdminList re-asks once for the last page when this one is now past the end.
    await reload()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể xóa các phiên trò chuyện đã chọn.'))
  } finally {
    deleting.value = false
  }
}

onMounted(reload)
</script>

<template>
  <div class="flex flex-col gap-5">
    <div>
      <h1 class="m-0 text-[1.3rem] font-extrabold text-brand-950">Phiên trò chuyện với Trợ lý</h1>
      <p class="mt-1 mb-0 text-[0.85rem] text-ink-muted">
        Nội dung khách đã hỏi Trợ lý AI, kèm địa chỉ IP, trình duyệt và thông tin liên hệ nếu khách có để lại.
      </p>
    </div>

    <!-- Filters -->
    <div class="flex flex-col gap-3 rounded-xl border border-line bg-white p-4 sm:flex-row sm:items-end">
      <label class="flex flex-1 flex-col gap-1">
        <span class="text-[0.78rem] font-bold text-ink-muted">Từ ngày</span>
        <input v-model="filters.from" type="date" class="rounded-lg border border-line-strong px-3 py-2 text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15" />
      </label>
      <label class="flex flex-1 flex-col gap-1">
        <span class="text-[0.78rem] font-bold text-ink-muted">Đến ngày</span>
        <input v-model="filters.to" type="date" class="rounded-lg border border-line-strong px-3 py-2 text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15" />
      </label>
      <label class="flex flex-1 flex-col gap-1">
        <span class="text-[0.78rem] font-bold text-ink-muted">Thông tin liên hệ</span>
        <select v-model="filters.hasContact" class="rounded-lg border border-line-strong px-3 py-2 text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15">
          <option value="">Tất cả</option>
          <option value="yes">Đã có số điện thoại</option>
          <option value="no">Chưa có</option>
        </select>
      </label>
      <div class="flex gap-2">
        <button type="button" class="rounded-lg bg-brand-700 px-4 py-2 text-sm font-bold text-white hover:bg-[#245a2a]" @click="applyFilters">Lọc</button>
        <button type="button" class="rounded-lg border border-line-strong px-4 py-2 text-sm font-bold text-[#445546] hover:bg-surface" @click="resetFilters">Xóa lọc</button>
      </div>
    </div>

    <AdminBulkActionBar
      v-if="canDelete && selection.count.value"
      :count="selection.count.value"
      :busy="deleting"
      noun="phiên trò chuyện"
      @clear="selection.clear()"
    >
      <button
        type="button"
        class="rounded-lg bg-danger px-3 py-2 text-sm font-bold text-white hover:bg-danger/90 focus:outline-none focus:ring-2 focus:ring-brand-700 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        :disabled="deleting"
        @click="bulkDelete"
      >
        <i class="fa-solid fa-trash-can mr-1 text-[0.75rem]" aria-hidden="true"></i>
        {{ deleting ? 'Đang xóa…' : 'Xóa vĩnh viễn' }}
      </button>
    </AdminBulkActionBar>

    <SkeletonTable v-if="loading" label="Đang tải danh sách phiên trò chuyện" :rows="6" :cols="6" />

    <div v-else-if="error" role="alert" class="rounded-xl border border-dashed border-[#e2a0a0] bg-white px-6 py-10 text-center text-[0.9rem] text-danger-soft">
      <i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>
      {{ error }}
      <button type="button" class="ml-1 font-bold text-brand-700 underline" @click="reload()">Thử lại</button>
    </div>

    <div v-else-if="rows.length === 0" class="rounded-xl border border-dashed border-line bg-white px-6 py-10 text-center text-[0.9rem] text-ink-muted">
      Chưa có phiên trò chuyện nào khớp điều kiện đang chọn.
    </div>

    <template v-else>
      <!-- Mobile cards -->
      <!-- A checkbox may not sit inside the link (interactive content in <a>): the
           card is a row holding the checkbox beside the link. -->
      <div class="divide-y divide-surface-tint overflow-hidden rounded-xl border border-line bg-white md:hidden">
        <div
          v-for="s in rows"
          :key="'m-' + s.id"
          class="flex items-start gap-3 px-4 hover:bg-surface"
          :class="selection.isSelected(s.id) ? 'bg-surface-tint' : ''"
        >
          <input
            v-if="canDelete"
            type="checkbox"
            class="mt-5 h-4 w-4 shrink-0 accent-brand-700"
            :checked="selection.isSelected(s.id)"
            :aria-label="`Chọn phiên của ${s.detectedName || s.ip || 'khách ẩn danh'}`"
            @change="selection.toggle(s.id)"
          />
          <nuxt-link :to="`/admin/chatbot/sessions/${s.id}`" class="block min-w-0 flex-1 py-4">
            <div class="mb-1 flex items-center justify-between gap-2">
              <span class="truncate text-[0.9rem] font-bold text-brand-950">
                {{ s.detectedName || s.ip || 'Khách ẩn danh' }}
              </span>
              <span class="shrink-0 text-[0.72rem] text-ink-muted">{{ fmtDate(s.lastMessageAt) }}</span>
            </div>
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8rem] text-[#445546]">
              <span><i class="fa-solid fa-comments text-[0.65rem] text-ink-muted" aria-hidden="true"></i> {{ s.messageCount }} tin nhắn</span>
              <span class="truncate"><i class="fa-solid fa-desktop text-[0.65rem] text-ink-muted" aria-hidden="true"></i> {{ s.browser }}</span>
              <span v-if="s.detectedPhone" class="font-bold text-brand-700">
                <i class="fa-solid fa-phone text-[0.65rem]" aria-hidden="true"></i> {{ s.detectedPhone }}
              </span>
            </div>
          </nuxt-link>
        </div>
      </div>

      <!-- Desktop table -->
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
                    aria-label="Chọn tất cả phiên đang hiển thị"
                    @change="selection.toggleAll(visibleIds)"
                  />
                </th>
                <th class="whitespace-nowrap border-b border-line bg-surface px-4 py-3 font-bold text-ink-muted">Địa chỉ IP</th>
                <th class="whitespace-nowrap border-b border-line bg-surface px-4 py-3 font-bold text-ink-muted">Trình duyệt</th>
                <th class="whitespace-nowrap border-b border-line bg-surface px-4 py-3 font-bold text-ink-muted">Bắt đầu</th>
                <th class="whitespace-nowrap border-b border-line bg-surface px-4 py-3 font-bold text-ink-muted">Tin nhắn cuối</th>
                <th class="whitespace-nowrap border-b border-line bg-surface px-4 py-3 font-bold text-ink-muted">Số tin</th>
                <th class="whitespace-nowrap border-b border-line bg-surface px-4 py-3 font-bold text-ink-muted">Liên hệ đã nêu</th>
                <th class="whitespace-nowrap border-b border-line bg-surface px-4 py-3 font-bold text-ink-muted">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in rows" :key="s.id" class="hover:bg-surface" :class="selection.isSelected(s.id) ? 'bg-surface-tint' : ''">
                <td v-if="canDelete" class="border-b border-surface-tint px-4 py-3.5">
                  <input
                    type="checkbox"
                    class="h-4 w-4 accent-brand-700"
                    :checked="selection.isSelected(s.id)"
                    :aria-label="`Chọn phiên của ${s.detectedName || s.ip || 'khách ẩn danh'}`"
                    @change="selection.toggle(s.id)"
                  />
                </td>
                <td class="border-b border-surface-tint px-4 py-3.5">
                  <code class="rounded bg-surface px-1.5 py-0.5 text-xs">{{ s.ip || '—' }}</code>
                </td>
                <td class="border-b border-surface-tint px-4 py-3.5 text-ink-admin">{{ s.browser }}</td>
                <td class="whitespace-nowrap border-b border-surface-tint px-4 py-3.5 text-ink-muted">{{ fmtDate(s.startedAt) }}</td>
                <td class="whitespace-nowrap border-b border-surface-tint px-4 py-3.5 text-ink-muted">{{ fmtDate(s.lastMessageAt) }}</td>
                <td class="border-b border-surface-tint px-4 py-3.5 text-ink-admin">{{ s.messageCount }}</td>
                <td class="border-b border-surface-tint px-4 py-3.5">
                  <span v-if="s.detectedPhone || s.detectedName" class="text-brand-700">
                    <span v-if="s.detectedName" class="font-bold">{{ s.detectedName }}</span>
                    <span v-if="s.detectedName && s.detectedPhone"> · </span>
                    <span v-if="s.detectedPhone">{{ s.detectedPhone }}</span>
                  </span>
                  <span v-else class="text-[#98a599]">—</span>
                </td>
                <td class="whitespace-nowrap border-b border-surface-tint px-4 py-3.5">
                  <nuxt-link :to="`/admin/chatbot/sessions/${s.id}`" class="font-bold text-brand-700 hover:underline">
                    Xem nội dung
                  </nuxt-link>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Pagination -->
      <AdminPagination
        :page="page"
        :total-pages="totalPages"
        :total="total"
        item-label="phiên"
        @update:page="goToPage"
      />
    </template>
  </div>
</template>
