<script setup lang="ts">
/**
 * System-wide activity log. Complements /admin/profile, which only shows the
 * signed-in account's own trail: this page reads every account's, so it is
 * gated on `users.read` server-side and hidden from the menu without it.
 */
definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

type LogItem = {
  id: number
  userId: number | null
  username: string | null
  action: string
  resource: string | null
  resourceId: number | null
  createdAt: string
  ip: string | null
  userAgent: string | null
  mfaMethod: string | null
}

const ACTION_LABELS: Record<string, string> = {
  login: 'Đăng nhập', logout: 'Đăng xuất', create: 'Thêm mới',
  update: 'Cập nhật', delete: 'Xoá', read: 'Xem',
  publish: 'Xuất bản', archive: 'Lưu trữ',
}
const RESOURCE_LABELS: Record<string, string> = {
  auth: 'Xác thực', profile_password: 'Mật khẩu tài khoản', profile_mfa: 'Xác thực hai bước',
  profile_recovery_codes: 'Mã dự phòng', user_mfa: 'Xác thực hai bước (tài khoản khác)',
  user_history: 'Lịch sử tài khoản khác', activity_logs: 'Lịch sử toàn hệ thống',
  news: 'Bài viết', media: 'Thư viện Media', pages: 'Trang', users: 'Người dùng',
  roles: 'Vai trò', settings: 'Cài đặt', submissions: 'Đơn đăng ký',
  chatbot_knowledge: 'Kho kiến thức Chatbot', chatbot_settings: 'Cài đặt Chatbot',
}
const MFA_METHOD_LABELS: Record<string, string> = {
  totp: 'ứng dụng xác thực', email_otp: 'mã qua email',
  second_password: 'mật khẩu cấp 2', recovery_code: 'mã dự phòng',
}

const items = ref<LogItem[]>([])
const loading = ref(true)
const error = ref('')
const page = ref(1)
const pageSize = 25
const total = ref(0)
const totalPages = ref(1)

const filterUserId = ref('')
const filterAction = ref('')
const filterResource = ref('')
const filterFrom = ref('')
const filterTo = ref('')

const accounts = ref<Array<{ id: number; username: string }>>([])
const retention = ref<any>(null)

async function loadAccounts() {
  try {
    const res = await $fetch<{ users?: Array<{ id: number; username: string }> }>('/api/admin/users')
    accounts.value = (res.users ?? []).map(item => ({ id: item.id, username: item.username }))
  } catch { accounts.value = [] }
}

async function loadRetention() {
  try { retention.value = await $fetch<any>('/api/admin/activity-logs/retention') } catch { retention.value = null }
}

async function load(next = page.value) {
  loading.value = true
  error.value = ''
  page.value = next
  try {
    const res = await $fetch<{ items?: LogItem[]; total?: number; totalPages?: number }>('/api/admin/activity-logs', {
      params: {
        page: next,
        pageSize,
        ...(filterUserId.value ? { userId: filterUserId.value } : {}),
        ...(filterAction.value ? { action: filterAction.value } : {}),
        ...(filterResource.value ? { resource: filterResource.value } : {}),
        // A bare date means midnight; the end of the range must include that day.
        ...(filterFrom.value ? { from: `${filterFrom.value}T00:00:00` } : {}),
        ...(filterTo.value ? { to: `${filterTo.value}T23:59:59` } : {}),
      },
    })
    items.value = res.items ?? []
    total.value = res.total ?? 0
    totalPages.value = res.totalPages ?? 1
  } catch (err: any) {
    error.value = err?.data?.statusMessage || 'Không tải được lịch sử hoạt động.'
    items.value = []
  } finally {
    loading.value = false
  }
}

function applyFilters() { return load(1) }
function resetFilters() {
  filterUserId.value = ''; filterAction.value = ''; filterResource.value = ''
  filterFrom.value = ''; filterTo.value = ''
  return load(1)
}
function goPage(next: number) {
  if (next < 1 || next > totalPages.value) return
  return load(next)
}

function actionLabel(item: LogItem) {
  const action = ACTION_LABELS[item.action] ?? item.action
  const resource = item.resource ? (RESOURCE_LABELS[item.resource] ?? item.resource) : ''
  return resource ? `${action} · ${resource}` : action
}
function formatWhen(value: string) {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString('vi-VN')
}
function formatDay(value: string | null) {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('vi-VN')
}
/** Full user-agent is long and unreadable; reduce to browser + OS. */
function shortAgent(agent: string | null) {
  if (!agent) return '—'
  const browser = /Edg\//.test(agent) ? 'Edge'
    : /OPR\//.test(agent) ? 'Opera'
    : /Chrome\//.test(agent) ? 'Chrome'
    : /Safari\//.test(agent) ? 'Safari'
    : /Firefox\//.test(agent) ? 'Firefox'
    : 'Khác'
  const os = /Windows/.test(agent) ? 'Windows'
    : /Android/.test(agent) ? 'Android'
    : /(iPhone|iPad)/.test(agent) ? 'iOS'
    : /Mac OS X/.test(agent) ? 'macOS'
    : /Linux/.test(agent) ? 'Linux'
    : ''
  return os ? `${browser} · ${os}` : browser
}

onMounted(() => { load(); loadAccounts(); loadRetention() })
</script>

<template>
  <div class="flex flex-col gap-5">
    <header>
      <h1 class="m-0 text-[1.3rem] font-extrabold text-[#122815]">Lịch sử truy cập &amp; hoạt động</h1>
      <p class="m-0 mt-1 text-sm text-[#667768]">Toàn bộ lượt đăng nhập và thao tác của mọi tài khoản quản trị. Mỗi lần xem trang này cũng được ghi vào nhật ký.</p>
    </header>

    <!-- Retention status: the purge needs an external cron, so its absence is surfaced here. -->
    <section v-if="retention" class="rounded-xl border border-[#e2ece3] bg-white p-4">
      <div class="flex flex-wrap gap-x-8 gap-y-3">
        <div><p class="m-0 text-xs font-bold uppercase tracking-wide text-[#667768]">Tổng bản ghi</p><p class="m-0 mt-0.5 text-lg font-extrabold text-[#122815]">{{ retention.total.toLocaleString('vi-VN') }}</p></div>
        <div><p class="m-0 text-xs font-bold uppercase tracking-wide text-[#667768]">Bản ghi cũ nhất</p><p class="m-0 mt-0.5 text-lg font-extrabold text-[#122815]">{{ formatDay(retention.oldest) }}</p></div>
        <div><p class="m-0 text-xs font-bold uppercase tracking-wide text-[#667768]">Thời hạn lưu</p><p class="m-0 mt-0.5 text-lg font-extrabold text-[#122815]">{{ retention.purgeDisabled ? 'Không tự xoá' : `${retention.retentionDays} ngày` }}</p></div>
        <div v-if="!retention.purgeDisabled"><p class="m-0 text-xs font-bold uppercase tracking-wide text-[#667768]">Quá hạn chưa xoá</p><p class="m-0 mt-0.5 text-lg font-extrabold" :class="retention.purgeOverdue ? 'text-[#a32924]' : 'text-[#1e4620]'">{{ retention.overdue.toLocaleString('vi-VN') }}</p></div>
      </div>

      <div v-if="retention.purgeOverdue" class="mt-3 flex items-start gap-2 rounded-lg border border-[#f0dcae] bg-[#fdf6e7] px-3.5 py-2.5 text-[0.82rem] text-[#8a6412]" role="status">
        <i class="fa-solid fa-triangle-exclamation mt-0.5" aria-hidden="true"></i>
        <span>Có {{ retention.overdue.toLocaleString('vi-VN') }} bản ghi vượt thời hạn {{ retention.retentionDays }} ngày nhưng chưa bị xoá. Tác vụ dọn dẹp không tự chạy — cần đặt cron trên máy chủ: <code class="rounded bg-white px-1.5 py-0.5 font-mono">{{ retention.command }}</code></span>
      </div>
      <div v-else-if="retention.purgeDisabled" class="mt-3 flex items-start gap-2 rounded-lg border border-[#e2ece3] bg-[#fafcfa] px-3.5 py-2.5 text-[0.82rem] text-[#667768]" role="status">
        <i class="fa-solid fa-circle-info mt-0.5" aria-hidden="true"></i>
        <span>Đang cấu hình giữ nhật ký vô thời hạn (<code class="font-mono">ACTIVITY_LOG_RETENTION_DAYS=0</code>). Bảng sẽ lớn dần và không có gì tự xoá.</span>
      </div>
      <div v-else class="mt-3 flex items-start gap-2 rounded-lg border border-[#cce5cd] bg-[#eef7ee] px-3.5 py-2.5 text-[0.82rem] text-[#1e4620]" role="status">
        <i class="fa-solid fa-circle-check mt-0.5" aria-hidden="true"></i>
        <span>Không có bản ghi nào quá hạn {{ retention.retentionDays }} ngày. Tác vụ dọn dẹp <code class="rounded bg-white px-1.5 py-0.5 font-mono">{{ retention.command }}</code> đang hoạt động đúng.</span>
      </div>
    </section>

    <!-- Filters -->
    <div class="flex flex-col gap-3 rounded-xl border border-[#e2ece3] bg-white p-4 sm:flex-row sm:flex-wrap sm:items-end">
      <label class="text-sm font-bold">Tài khoản
        <select v-model="filterUserId" class="mt-1 w-full rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal outline-none focus:border-[#2c6e33]">
          <option value="">Tất cả</option>
          <option v-for="account in accounts" :key="account.id" :value="String(account.id)">{{ account.username }}</option>
        </select>
      </label>
      <label class="text-sm font-bold">Hoạt động
        <select v-model="filterAction" class="mt-1 w-full rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal outline-none focus:border-[#2c6e33]">
          <option value="">Tất cả</option>
          <option v-for="(label, key) in ACTION_LABELS" :key="key" :value="key">{{ label }}</option>
        </select>
      </label>
      <label class="text-sm font-bold">Đối tượng
        <select v-model="filterResource" class="mt-1 w-full rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal outline-none focus:border-[#2c6e33]">
          <option value="">Tất cả</option>
          <option v-for="(label, key) in RESOURCE_LABELS" :key="key" :value="key">{{ label }}</option>
        </select>
      </label>
      <label class="text-sm font-bold">Từ ngày<input v-model="filterFrom" type="date" class="mt-1 w-full rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal outline-none focus:border-[#2c6e33]" /></label>
      <label class="text-sm font-bold">Đến ngày<input v-model="filterTo" type="date" class="mt-1 w-full rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal outline-none focus:border-[#2c6e33]" /></label>
      <div class="flex gap-2">
        <button type="button" class="rounded-lg bg-[#1e4620] px-4 py-2.5 font-bold text-white hover:bg-[#2c6e33]" @click="applyFilters">Lọc</button>
        <button type="button" class="rounded-lg border border-[#c8d6c9] px-4 py-2.5 font-bold text-[#2c6e33] hover:bg-[#f0f7f1]" @click="resetFilters">Xoá lọc</button>
      </div>
    </div>

    <div v-if="error" class="rounded-lg border border-[#f1b8b5] bg-[#fff4f3] p-3 text-sm text-[#a32924]" role="alert">{{ error }}</div>

    <SkeletonTable v-if="loading" label="Đang tải lịch sử hoạt động" :rows="8" :cols="6" />

    <div v-else-if="!items.length" class="rounded-xl border border-[#e2ece3] bg-white p-12 text-center">
      <i class="fa-solid fa-clock-rotate-left mb-3 text-3xl text-[#c8d6c9]" aria-hidden="true"></i>
      <p class="m-0 font-semibold text-[#667768]">Không có bản ghi nào khớp điều kiện lọc.</p>
    </div>

    <div v-else class="overflow-hidden rounded-xl border border-[#e2ece3] bg-white">
      <div class="overflow-x-auto">
        <table class="w-full min-w-[860px] border-collapse text-left text-[0.84rem]">
          <caption class="sr-only">Lịch sử truy cập và hoạt động của mọi tài khoản, mới nhất trước</caption>
          <thead class="bg-[#f4f7f4] text-xs uppercase tracking-wide text-[#667768]">
            <tr>
              <th scope="col" class="whitespace-nowrap px-3.5 py-3">Thời điểm</th>
              <th scope="col" class="px-3.5 py-3">Tài khoản</th>
              <th scope="col" class="px-3.5 py-3">Hoạt động</th>
              <th scope="col" class="whitespace-nowrap px-3.5 py-3">Địa chỉ IP</th>
              <th scope="col" class="whitespace-nowrap px-3.5 py-3">Thiết bị</th>
              <th scope="col" class="whitespace-nowrap px-3.5 py-3">Xác thực</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in items" :key="item.id" class="border-t border-[#eef2ee] transition-colors hover:bg-[#fafcfa]">
              <td class="whitespace-nowrap px-3.5 py-2.5 text-[#3d4a3e]">{{ formatWhen(item.createdAt) }}</td>
              <td class="px-3.5 py-2.5 font-semibold text-[#122815]">
                {{ item.username || (item.userId ? `#${item.userId}` : 'Hệ thống') }}
                <span v-if="item.userId && !item.username" class="ml-1 rounded border border-[#c8d6c9] px-1.5 py-0.5 text-[0.7rem] font-normal text-[#667768]">đã xoá</span>
              </td>
              <td class="px-3.5 py-2.5 text-[#3d4a3e]">
                {{ actionLabel(item) }}
                <span v-if="item.resourceId" class="text-[#667768]"> #{{ item.resourceId }}</span>
              </td>
              <td class="px-3.5 py-2.5 font-mono text-[0.8rem] text-[#667768]">{{ item.ip || '—' }}</td>
              <td class="px-3.5 py-2.5 text-[#667768]">{{ shortAgent(item.userAgent) }}</td>
              <td class="px-3.5 py-2.5 text-[#667768]">
                <span v-if="item.mfaMethod" class="inline-flex items-center gap-1 rounded-full border border-[#cce5cd] bg-[#eef7ee] px-2 py-0.5 text-[0.72rem] font-bold text-[#1e4620]">
                  <i class="fa-solid fa-shield-halved" aria-hidden="true"></i>
                  {{ MFA_METHOD_LABELS[item.mfaMethod] ?? item.mfaMethod }}
                </span>
                <span v-else>—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <nav class="flex flex-wrap items-center justify-between gap-3 border-t border-[#eef2ee] p-4" aria-label="Phân trang">
        <span class="text-sm text-[#667768]">{{ total.toLocaleString('vi-VN') }} bản ghi</span>
        <div class="flex items-center gap-2">
          <button type="button" :disabled="page <= 1" class="rounded border border-[#c8d6c9] px-3 py-1.5 font-semibold disabled:opacity-40" @click="goPage(page - 1)">Trước</button>
          <span class="px-2 py-1.5 text-sm font-bold">Trang {{ page }} / {{ totalPages }}</span>
          <button type="button" :disabled="page >= totalPages" class="rounded border border-[#c8d6c9] px-3 py-1.5 font-semibold disabled:opacity-40" @click="goPage(page + 1)">Sau</button>
        </div>
      </nav>
    </div>
  </div>
</template>
