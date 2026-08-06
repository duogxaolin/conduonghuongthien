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

const BAN_FILTERS = [
  { value: 'all', label: 'Tất cả' },
  { value: 'active', label: 'Đang hoạt động' },
  { value: 'banned', label: 'Đã bị chặn' },
] as const

const loading = ref(true)
const error = ref('')
const readers = ref<Reader[]>([])
const total = ref(0)
const page = ref(1)
const totalPages = ref(1)

const search = ref('')
const banned = ref<'all' | 'active' | 'banned'>('all')

function formatMoment(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('vi-VN', { hour12: false })
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await $fetch<any>('/api/admin/readers', {
      query: { q: search.value || undefined, banned: banned.value, page: page.value },
    })
    if (!res?.ok) {
      error.value = 'Không tải được danh sách người đọc.'
      return
    }
    readers.value = res.readers || []
    total.value = res.total || 0
    totalPages.value = res.totalPages || 1
    page.value = res.page || 1
  } catch (err: unknown) {
    // Never left as an empty table: an empty list and a failed fetch look
    // identical on screen, and an officer would conclude nobody has signed up.
    error.value = errorMessage(err, 'Không tải được danh sách người đọc.')
  } finally {
    loading.value = false
  }
}

function applyFilters() {
  page.value = 1
  load()
}

function goToPage(next: number) {
  if (next < 1 || next > totalPages.value) return
  page.value = next
  load()
}

onMounted(load)
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
          v-model="search"
          type="search"
          maxlength="100"
          placeholder="Nhập tên hiển thị hoặc email…"
          class="rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/20"
        />
      </label>
      <label class="flex flex-col gap-1.5 text-sm font-bold">
        Trạng thái
        <select
          v-model="banned"
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
      <button type="button" class="ml-1 font-bold text-[#2c6e33] underline" @click="load">Thử lại</button>
    </div>

    <template v-else>
      <!-- Rỗng -->
      <p v-if="!readers.length" class="rounded-xl border border-[#e2ece3] bg-white px-5 py-8 text-center text-sm text-[#667768]">
        Chưa có tài khoản người đọc nào khớp bộ lọc hiện tại.
      </p>

      <div v-else class="overflow-x-auto rounded-xl border border-[#e2ece3] bg-white">
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

      <div v-if="totalPages > 1" class="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          class="rounded-lg border border-[#c8d6c9] bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50"
          :disabled="page <= 1"
          @click="goToPage(page - 1)"
        >Trang trước</button>
        <span class="text-sm text-[#3d4f3f]">Trang {{ page }} / {{ totalPages }} — {{ total }} tài khoản</span>
        <button
          type="button"
          class="rounded-lg border border-[#c8d6c9] bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50"
          :disabled="page >= totalPages"
          @click="goToPage(page + 1)"
        >Trang sau</button>
      </div>
    </template>
  </div>
</template>
