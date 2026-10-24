<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

/**
 * Reader accounts — the people who signed in with Google to comment.
 *
 * This page reads citizens' personal data (display name, email, last address),
 * so every load writes an audit row on the server carrying the filters used. It
 * needs the `readers` resource, which ships granted to nobody: a 403 here after
 * upgrading is the expected state until an administrator grants it.
 */

type Reader = {
  id: number
  displayName: string | null
  email: string | null
  isBanned: boolean
  banReason: string | null
  bannedAt: string | null
  createdAt: string | null
  lastSeenAt: string | null
  lastIp: string | null
  commentCount: number
}

type ReaderFilters = {
  /** Name or email fragment; applied on submit. */
  q: string
  /** Applied as soon as the select changes. */
  banned: 'all' | 'active' | 'banned'
}

type ReaderListResponse = { ok: boolean; readers: Reader[]; total: number; totalPages: number; page: number }

const BAN_FILTERS = [
  { value: 'all', label: 'Tất cả' },
  { value: 'active', label: 'Đang hoạt động' },
  { value: 'banned', label: 'Đã bị chặn' },
] as const

// List state, stale-request guard and paging: useAdminList (tests/admin-list.test.ts).
const list = useAdminList<Reader, ReaderFilters>({
  filters: { q: '', banned: 'all' },
  // Never left as an empty table: an empty list and a failed fetch look
  // identical on screen, and an officer would conclude nobody has signed up.
  errorFallback: 'Không tải được danh sách người đọc.',
  load: async ({ page, filters, signal }) => {
    const res = await adminFetch<ReaderListResponse>('/api/admin/readers', {
      query: { q: filters.q || undefined, banned: filters.banned, page },
      signal,
    })
    if (!res?.ok) return null
    return { items: res.readers || [], total: res.total || 0, totalPages: res.totalPages || 1, page: res.page || 1 }
  },
})
const { items: readers, page, total, totalPages, loading, filters, applyFilters, goToPage } = list
// The error branch and its retry are declared here, in the page, on purpose:
// tests/admin-error-retry-ui.test.ts reads this file's own source.
const error = computed(() => list.error.value)
const reload = list.reload

function formatMoment(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('vi-VN', { hour12: false })
}

onMounted(reload)
</script>

<template>
  <div class="flex flex-col gap-5">
    <div>
      <h1 class="m-0 text-[1.35rem] font-extrabold text-[#122815]">Người đọc &amp; bình luận</h1>
      <p class="m-0 mt-1 text-sm text-[#667768]">
        Tài khoản Google đã đăng nhập để bình luận. Mỗi lượt xem trang này được ghi vào lịch sử hoạt động kèm bộ lọc đã dùng.
      </p>
    </div>

    <form class="flex flex-wrap items-end gap-3 rounded-xl border border-[#e2ece3] bg-white p-4" @submit.prevent="applyFilters">
      <label class="flex min-w-[220px] flex-1 flex-col gap-1.5 text-sm font-bold">
        Tìm theo tên hoặc email
        <input
          v-model="filters.q"
          type="search"
          maxlength="100"
          placeholder="Nhập tên hiển thị hoặc email…"
          class="rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/20"
        />
      </label>
      <label class="flex flex-col gap-1.5 text-sm font-bold">
        Trạng thái
        <select
          v-model="filters.banned"
          class="rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/20"
          @change="applyFilters"
        >
          <option v-for="item in BAN_FILTERS" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
      </label>
      <button
        type="submit"
        class="rounded-lg bg-[#1e4620] px-4 py-2.5 font-bold text-white hover:bg-[#2c6e33] focus:outline-none focus:ring-2 focus:ring-[#2c6e33]/40"
      >Tìm</button>
      <nuxt-link
        to="/admin/comments"
        class="rounded-lg border border-[#c8d6c9] bg-white px-4 py-2.5 font-semibold text-[#2c3e2e] no-underline hover:bg-[#f0f7f1]"
      >Kiểm duyệt bình luận</nuxt-link>
      <nuxt-link
        to="/admin/settings/ip-bans"
        class="rounded-lg border border-[#c8d6c9] bg-white px-4 py-2.5 font-semibold text-[#2c3e2e] no-underline hover:bg-[#f0f7f1]"
      >Chặn địa chỉ IP</nuxt-link>
    </form>

    <!-- Đang tải -->
    <div v-if="loading" role="status" aria-busy="true" class="rounded-xl border border-[#e2ece3] bg-white p-4">
      <span class="sr-only">Đang tải danh sách người đọc</span>
      <div
        v-for="n in 6"
        :key="n"
        aria-hidden="true"
        class="mb-2 h-11 rounded-lg bg-[#eef3ee] animate-pulse motion-reduce:animate-none"
      ></div>
    </div>

    <!-- Lỗi -->
    <div
      v-else-if="error"
      role="alert"
      class="rounded-lg border border-dashed border-[#e0a3a1] bg-white px-5 py-6 text-center text-sm text-[#b0403c]"
    >
      <i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>
      {{ error }}
      <button type="button" class="ml-1 font-bold text-[#2c6e33] underline" @click="reload">Thử lại</button>
    </div>

    <template v-else>
      <!-- Rỗng -->
      <p v-if="!readers.length" class="rounded-xl border border-[#e2ece3] bg-white px-5 py-8 text-center text-sm text-[#667768]">
        Chưa có tài khoản người đọc nào khớp bộ lọc hiện tại.
      </p>

      <!-- Mobile Card View: Tối ưu cho màn hình điện thoại, dễ thao tác ngón cái -->
      <div class="md:hidden divide-y divide-[#eef3ee] rounded-xl border border-[#e2ece3] bg-white overflow-hidden shadow-xs">
        <div
          v-for="reader in readers"
          :key="'m-'+reader.id"
          class="p-4 flex flex-col gap-2.5 transition-colors active:bg-[#f8faf8]"
        >
          <div class="flex items-start justify-between gap-2.5">
            <div class="flex items-center gap-2.5 min-w-0">
              <ReaderAvatar :initials="(reader.displayName || '?').slice(0, 1)" size="sm" />
              <div class="min-w-0">
                <p class="m-0 truncate font-bold text-[#122815] text-[0.9rem]">{{ reader.displayName || 'Chưa có tên' }}</p>
                <p class="m-0 truncate text-[0.78rem] text-[#667768]">{{ reader.email || '—' }}</p>
              </div>
            </div>
            <span
              v-if="reader.isBanned"
              class="inline-block rounded-full bg-[#fdecec] px-2.5 py-0.5 text-[0.7rem] font-bold text-[#b0403c] shrink-0"
            >Đã chặn</span>
            <span v-else class="inline-block rounded-full bg-[#eef7ef] px-2.5 py-0.5 text-[0.7rem] font-bold text-[#2c6e33] shrink-0">Hoạt động</span>
          </div>

          <div class="flex items-center justify-between text-xs text-[#667768] pt-2 border-t border-[#f4f7f4]">
            <span class="flex items-center gap-1.5">
              <i class="fa-regular fa-comment text-[0.75rem] text-[#2c6e33]" aria-hidden="true"></i>
              <span>{{ reader.commentCount }} bình luận</span>
            </span>
            <span class="text-[0.72rem] text-[#8a9a8c]">
              {{ formatMoment(reader.lastSeenAt) }}
            </span>
          </div>

          <div class="flex items-center justify-between pt-1">
            <code v-if="reader.lastIp" class="text-[0.72rem] bg-[#f4f7f4] px-1.5 py-0.5 rounded text-[#667768]">{{ reader.lastIp }}</code>
            <span v-else></span>
            <nuxt-link
              :to="`/admin/readers/${reader.id}`"
              class="inline-flex items-center gap-1 text-xs font-bold text-[#2c6e33] bg-[#f0f7f1] hover:bg-[#e4f2e5] px-3 py-1.5 rounded-lg no-underline transition-colors"
            >
              <span>Xem chi tiết</span>
              <i class="fa-solid fa-chevron-right text-[0.65rem]" aria-hidden="true"></i>
            </nuxt-link>
          </div>
        </div>
      </div>

      <!-- Desktop Table View: Giữ nguyên bảng đầy đủ cho màn hình lớn -->
      <div class="hidden md:block overflow-x-auto rounded-xl border border-[#e2ece3] bg-white">
        <table class="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr class="bg-[#f8faf8] text-left text-[0.78rem] uppercase tracking-wide text-[#667768]">
              <th class="px-4 py-3 font-bold">Người đọc</th>
              <th class="px-4 py-3 font-bold">Bình luận</th>
              <th class="px-4 py-3 font-bold">Truy cập gần nhất</th>
              <th class="px-4 py-3 font-bold">Trạng thái</th>
              <th class="px-4 py-3 font-bold"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="reader in readers" :key="reader.id" class="border-t border-[#eef3ee]">
              <td class="px-4 py-3">
                <div class="flex items-center gap-2.5">
                  <ReaderAvatar :initials="(reader.displayName || '?').slice(0, 1)" size="sm" />
                  <div class="min-w-0">
                    <p class="m-0 truncate font-bold text-[#122815]">{{ reader.displayName || 'Chưa có tên' }}</p>
                    <p class="m-0 truncate text-[0.8rem] text-[#667768]">{{ reader.email || '—' }}</p>
                  </div>
                </div>
              </td>
              <td class="px-4 py-3 font-semibold text-[#2c3e2e]">{{ reader.commentCount }}</td>
              <td class="px-4 py-3 text-[#3d4f3f]">
                {{ formatMoment(reader.lastSeenAt) }}
                <span v-if="reader.lastIp" class="block text-[0.78rem] text-[#8a9a8c]">{{ reader.lastIp }}</span>
              </td>
              <td class="px-4 py-3">
                <span
                  v-if="reader.isBanned"
                  class="inline-block rounded-full bg-[#fdecec] px-2.5 py-1 text-[0.75rem] font-bold text-[#b0403c]"
                >Đã chặn</span>
                <span v-else class="inline-block rounded-full bg-[#eef7ef] px-2.5 py-1 text-[0.75rem] font-bold text-[#2c6e33]">Hoạt động</span>
              </td>
              <td class="px-4 py-3 text-right">
                <nuxt-link
                  :to="`/admin/readers/${reader.id}`"
                  class="font-semibold text-[#2c6e33] no-underline hover:underline"
                >Xem chi tiết</nuxt-link>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <AdminPagination
        :page="page"
        :total-pages="totalPages"
        :total="total"
        item-label="tài khoản"
        @update:page="goToPage"
      />
    </template>
  </div>
</template>
