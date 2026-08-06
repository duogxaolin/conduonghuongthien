<script setup lang="ts">
/**
 * Khối "Lịch sử truy cập & hoạt động" của trang /admin/profile.
 *
 * Tách khỏi `profile.vue` (1076 dòng) — tệp đó gộp bốn luồng độc lập vào một
 * chỗ: đổi mật khẩu, ba yếu tố xác thực hai bước, mã dự phòng, và khối này.
 * Đây là khối tách sạch nhất: state của nó (phân trang, tài khoản đang xem)
 * không giao với ba luồng kia, và ba hộp thoại MFA không chạm tới nó.
 *
 * Nhưng nó KHÔNG hoàn toàn độc lập, và chỗ đó mới là phần phải giữ đúng: bật
 * hoặc tắt một yếu tố sẽ ghi thêm một dòng vào chính bảng này, nên trang cha
 * phải làm mới được danh sách sau hai thao tác đó. Vì vậy component `expose`
 * hàm `reload()` thay vì tự nạp rồi thôi — nếu không, người dùng vừa bật xác
 * thực hai bước sẽ nhìn vào một danh sách không có dòng họ vừa tạo ra và kết
 * luận là hệ thống không ghi nhận.
 *
 * Mọi lượt xem lịch sử tài khoản KHÁC đều được máy chủ ghi log (chỉ SuperAdmin
 * thấy bộ chọn) — một nhật ký quét được trong im lặng là công cụ theo dõi, nên
 * hành vi xem cũng phải để lại dấu vết.
 */
interface HistoryItem {
  id: number
  action: string
  resource: string | null
  resourceId: number | null
  createdAt: string
  ip: string | null
  userAgent: string | null
  mfaMethod: string | null
}

const { user } = useAdminAuth()

const ACTION_LABELS: Record<string, string> = {
  login: 'Đăng nhập', logout: 'Đăng xuất', create: 'Thêm mới',
  update: 'Cập nhật', delete: 'Xoá', read: 'Xem',
}
const RESOURCE_LABELS: Record<string, string> = {
  auth: 'Xác thực', profile_password: 'Mật khẩu tài khoản', profile_mfa: 'Xác thực hai bước',
  profile_recovery_codes: 'Mã dự phòng',
  user_mfa: 'Xác thực hai bước (tài khoản khác)', user_history: 'Lịch sử tài khoản khác',
  news: 'Bài viết', media: 'Thư viện Media', pages: 'Trang', users: 'Người dùng',
  roles: 'Vai trò', settings: 'Cài đặt', submissions: 'Đơn đăng ký',
}
const MFA_METHOD_LABELS: Record<string, string> = {
  totp: 'ứng dụng xác thực', email_otp: 'mã qua email',
  second_password: 'mật khẩu cấp 2', recovery_code: 'mã dự phòng',
}

const history = ref<HistoryItem[]>([])
const historyLoading = ref(true)
const historyError = ref('')
const historyPage = ref(1)
const historyTotal = ref(0)
const historyTotalPages = ref(1)
const historyPageSize = 20
// SuperAdmin xem lịch sử tài khoản khác; rỗng = lịch sử của chính mình.
const historyTargetId = ref<string>('')
const historyTargetName = ref<string | null>(null)
const otherUsers = ref<Array<{ id: number; username: string }>>([])

async function loadHistory() {
  historyLoading.value = true
  historyError.value = ''
  try {
    const res = await $fetch<{
      ok: boolean; items: HistoryItem[]; total: number; totalPages: number; targetUsername: string | null
    }>('/api/admin/profile/history', {
      query: {
        page: historyPage.value,
        pageSize: historyPageSize,
        ...(historyTargetId.value ? { userId: historyTargetId.value } : {}),
      },
    })
    history.value = res.items ?? []
    historyTotal.value = res.total ?? 0
    historyTotalPages.value = res.totalPages ?? 1
    historyTargetName.value = res.targetUsername
  } catch (err: any) {
    historyError.value = err?.data?.statusMessage || 'Không tải được lịch sử.'
    history.value = []
  } finally {
    historyLoading.value = false
  }
}

async function loadOtherUsers() {
  if (!user.value?.isSuperAdmin) return
  try {
    const res = await $fetch<{ ok: boolean; users: Array<{ id: number; username: string }> }>('/api/admin/users')
    otherUsers.value = (res.users ?? []).filter(u => u.id !== user.value?.id)
  } catch {
    // Không chặn trang: bộ chọn tài khoản khác chỉ là tiện ích.
  }
}

function changeHistoryTarget() {
  historyPage.value = 1
  loadHistory()
}

function goHistoryPage(page: number) {
  if (page < 1 || page > historyTotalPages.value) return
  historyPage.value = page
  loadHistory()
}

function actionLabel(item: HistoryItem) {
  const action = ACTION_LABELS[item.action] ?? item.action
  const resource = item.resource ? (RESOURCE_LABELS[item.resource] ?? item.resource) : ''
  return resource ? `${action} · ${resource}` : action
}

/** User-agent đầy đủ vừa dài vừa khó đọc; rút về trình duyệt + hệ điều hành. */
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

onMounted(async () => {
  await Promise.all([loadHistory(), loadOtherUsers()])
})

// Bật/tắt một yếu tố ghi thêm một dòng vào chính bảng này — xem chú thích đầu tệp.
defineExpose({ reload: loadHistory })
</script>

<template>
  <section class="rounded-xl border border-[#e2ece3] bg-white p-5">
    <div class="flex items-center gap-3 mb-4 flex-wrap">
      <span class="w-1 h-5 rounded-full bg-[#2c6e33]" aria-hidden="true"></span>
      <h2 class="text-[1rem] font-extrabold text-[#122815] m-0">Lịch sử truy cập &amp; hoạt động</h2>
      <span v-if="!historyLoading && historyTotal > 0" class="text-[0.78rem] text-[#667768]">
        {{ historyTotal }} bản ghi
      </span>

      <!-- Bộ chọn tài khoản: chỉ SuperAdmin thấy, và mỗi lần xem tài khoản khác đều được ghi log -->
      <div v-if="user?.isSuperAdmin && otherUsers.length" class="ml-auto flex items-center gap-2">
        <label for="history-target" class="text-[0.8rem] font-semibold text-[#3d4a3e]">Xem của:</label>
        <select
          id="history-target"
          v-model="historyTargetId"
          class="rounded-lg border border-[#e2ece3] bg-white px-3 py-2 text-[0.84rem] text-[#122815] focus:outline-none focus:ring-2 focus:ring-[#2c6e33] focus:border-[#2c6e33]"
          @change="changeHistoryTarget"
        >
          <option value="">Tài khoản của tôi</option>
          <option v-for="u in otherUsers" :key="u.id" :value="String(u.id)">{{ u.username }}</option>
        </select>
      </div>
    </div>

    <p v-if="historyTargetId && historyTargetName" class="flex items-start gap-2 bg-[#fdf6e7] border border-[#f0dcae] text-[#8a6412] px-3.5 py-2.5 rounded-lg text-[0.82rem] mt-0 mb-4">
      <i class="fa-solid fa-circle-info shrink-0 mt-0.5" aria-hidden="true"></i>
      <span>Bạn đang xem lịch sử của <strong>{{ historyTargetName }}</strong>. Lần xem này được ghi vào nhật ký hệ thống.</span>
    </p>

    <SkeletonTable v-if="historyLoading" label="Đang tải lịch sử hoạt động" :rows="6" :cols="5" />

    <div v-else-if="historyError" class="flex items-start gap-2 bg-[#ffebe9] border border-[#ffc1ba] text-[#d12420] px-3.5 py-3 rounded-lg text-[0.84rem]" role="alert">
      <i class="fa-solid fa-triangle-exclamation shrink-0 mt-0.5" aria-hidden="true"></i>
      <div>
        <div>{{ historyError }}</div>
        <button type="button" class="mt-2 text-[0.82rem] font-bold underline bg-transparent border-0 cursor-pointer text-[#d12420] rounded focus:outline-none focus:ring-2 focus:ring-[#d12420]/40" @click="loadHistory">Thử lại</button>
      </div>
    </div>

    <div v-else-if="!history.length" class="rounded-lg border border-dashed border-[#dce8dd] bg-[#fafcfa] p-8 text-center">
      <i class="fa-solid fa-clock-rotate-left text-2xl text-[#b6cdb8] mb-2 block" aria-hidden="true"></i>
      <p class="text-[0.85rem] text-[#667768] m-0">Chưa có bản ghi nào trong khoảng thời gian lưu trữ.</p>
    </div>

    <template v-else>
      <div class="overflow-x-auto rounded-lg border border-[#e2ece3]">
        <table class="w-full border-collapse text-[0.84rem]">
          <caption class="sr-only">Danh sách lượt truy cập và hoạt động, mới nhất trước</caption>
          <thead>
            <tr class="bg-[#fafcfa]">
              <th scope="col" class="text-left font-bold text-[#3d4a3e] px-3.5 py-2.5 border-b border-[#e2ece3] whitespace-nowrap">Thời điểm</th>
              <th scope="col" class="text-left font-bold text-[#3d4a3e] px-3.5 py-2.5 border-b border-[#e2ece3]">Hoạt động</th>
              <th scope="col" class="text-left font-bold text-[#3d4a3e] px-3.5 py-2.5 border-b border-[#e2ece3] whitespace-nowrap">Địa chỉ IP</th>
              <th scope="col" class="text-left font-bold text-[#3d4a3e] px-3.5 py-2.5 border-b border-[#e2ece3] whitespace-nowrap">Thiết bị</th>
              <th scope="col" class="text-left font-bold text-[#3d4a3e] px-3.5 py-2.5 border-b border-[#e2ece3] whitespace-nowrap">Xác thực</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in history" :key="item.id" class="hover:bg-[#fafcfa] transition-colors">
              <td class="px-3.5 py-2.5 border-b border-[#f0f4f0] text-[#3d4a3e] whitespace-nowrap">{{ formatDateTimeVN(item.createdAt) }}</td>
              <td class="px-3.5 py-2.5 border-b border-[#f0f4f0] text-[#122815] font-semibold">{{ actionLabel(item) }}</td>
              <td class="px-3.5 py-2.5 border-b border-[#f0f4f0] text-[#667768] font-mono text-[0.8rem]">{{ item.ip || '—' }}</td>
              <td class="px-3.5 py-2.5 border-b border-[#f0f4f0] text-[#667768]">{{ shortAgent(item.userAgent) }}</td>
              <td class="px-3.5 py-2.5 border-b border-[#f0f4f0] text-[#667768]">
                <span v-if="item.mfaMethod" class="inline-flex items-center gap-1 text-[0.72rem] font-bold px-2 py-0.5 rounded-full bg-[#eef7ee] border border-[#cce5cd] text-[#1e4620]">
                  <i class="fa-solid fa-shield-halved" aria-hidden="true"></i>
                  {{ MFA_METHOD_LABELS[item.mfaMethod] ?? item.mfaMethod }}
                </span>
                <span v-else>—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="historyTotalPages > 1" class="flex items-center justify-between gap-3 mt-3 flex-wrap">
        <span class="text-[0.8rem] text-[#667768]">Trang {{ historyPage }} / {{ historyTotalPages }}</span>
        <div class="flex items-center gap-2">
          <button
            type="button" :disabled="historyPage <= 1"
            class="inline-flex items-center gap-2 rounded-lg border border-[#e2ece3] bg-white px-3 py-2 text-[0.82rem] font-semibold text-[#3d4a3e] hover:bg-[#f0f7f1] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[#2c6e33]"
            @click="goHistoryPage(historyPage - 1)"
          >
            <i class="fa-solid fa-chevron-left" aria-hidden="true"></i>
            Trước
          </button>
          <button
            type="button" :disabled="historyPage >= historyTotalPages"
            class="inline-flex items-center gap-2 rounded-lg border border-[#e2ece3] bg-white px-3 py-2 text-[0.82rem] font-semibold text-[#3d4a3e] hover:bg-[#f0f7f1] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[#2c6e33]"
            @click="goHistoryPage(historyPage + 1)"
          >
            Sau
            <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
          </button>
        </div>
      </div>
    </template>
  </section>
</template>
