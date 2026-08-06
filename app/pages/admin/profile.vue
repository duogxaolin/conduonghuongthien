<script setup lang="ts">
/**
 * Tài khoản của tôi — đổi mật khẩu, bật/tắt yếu tố thứ hai, xem lịch sử.
 *
 * Không gắn hasPermission ở bất kỳ chỗ nào: mọi thao tác trên trang này đều nhắm
 * vào chính tài khoản đang đăng nhập, và server lấy danh tính từ phiên chứ không
 * nhận id từ request. Ngoại lệ duy nhất là ô xem lịch sử tài khoản khác, chỉ hiện
 * với SuperAdmin.
 */
definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

type FactorType = 'totp' | 'email_otp' | 'second_password'

interface FactorRow {
  factorType: FactorType
  state: 'disabled' | 'pending' | 'active'
  usable: boolean
  enrolledAt: string | null
  lastUsedAt: string | null
}

interface MfaStatus {
  ok: boolean
  email: string | null
  smtpReady: boolean
  factors: FactorRow[]
  recoveryCodesEnabled: boolean
  recoveryCodesRemaining: number
  lockoutRisk: boolean
}

const { user } = useAdminAuth()
const toast = useToast()

const FACTOR_META: Record<FactorType, { label: string; icon: string; desc: string }> = {
  totp: {
    label: 'Ứng dụng xác thực (Google Authenticator)',
    icon: 'fa-solid fa-mobile-screen-button',
    desc: 'Mã 6 số đổi mỗi 30 giây, sinh ngay trên điện thoại — không cần mạng.',
  },
  email_otp: {
    label: 'Mã OTP gửi về email',
    icon: 'fa-solid fa-envelope',
    desc: 'Mỗi lần đăng nhập, hệ thống gửi mã 6 số về email của bạn. Mã sống 10 phút.',
  },
  second_password: {
    label: 'Mật khẩu cấp 2',
    icon: 'fa-solid fa-key',
    desc: 'Một mật khẩu riêng, khác mật khẩu đăng nhập, hỏi thêm ở bước thứ hai.',
  },
}

// ── Đổi mật khẩu ─────────────────────────────────────────────────────────────
const pw = reactive({ current: '', next: '', confirm: '' })
const pwSaving = ref(false)
const pwError = ref('')

async function changePassword() {
  pwError.value = ''
  if (!pw.current || !pw.next) {
    pwError.value = 'Vui lòng nhập mật khẩu hiện tại và mật khẩu mới.'
    return
  }
  if (pw.next !== pw.confirm) {
    pwError.value = 'Mật khẩu mới và ô nhập lại không khớp.'
    return
  }
  pwSaving.value = true
  try {
    const res = await $fetch<{ ok: boolean; message: string }>('/api/admin/profile/password', {
      method: 'PUT',
      body: { currentPassword: pw.current, newPassword: pw.next },
    })
    toast.success(res.message || 'Đã đổi mật khẩu.')
    pw.current = ''; pw.next = ''; pw.confirm = ''
  } catch (err: any) {
    pwError.value = err?.data?.statusMessage || 'Không đổi được mật khẩu.'
  } finally {
    pwSaving.value = false
  }
}

// ── Trạng thái yếu tố thứ hai ────────────────────────────────────────────────
const mfa = ref<MfaStatus | null>(null)
const mfaLoading = ref(true)
const mfaError = ref('')

async function loadMfa() {
  mfaLoading.value = true
  mfaError.value = ''
  try {
    mfa.value = await $fetch<MfaStatus>('/api/admin/profile/mfa')
  } catch (err: any) {
    mfaError.value = err?.data?.statusMessage || 'Không tải được trạng thái xác thực hai bước.'
  } finally {
    mfaLoading.value = false
  }
}

const activeFactors = computed(() => mfa.value?.factors.filter(f => f.state === 'active') ?? [])

/** Email OTP cần SMTP; các yếu tố khác thì không. */
function canEnroll(type: FactorType) {
  if (type !== 'email_otp') return true
  return mfa.value?.smtpReady === true && !!mfa.value?.email
}

// ── Luồng bật một yếu tố (enroll → confirm) ──────────────────────────────────
const enrollDialog = reactive({
  open: false,
  factorType: 'totp' as FactorType,
  stage: 'password' as 'password' | 'confirm',
  currentPassword: '',
  secondPassword: '',
  secondPasswordConfirm: '',
  totpSecret: '',
  otpauthUri: '',
  sentTo: '',
  code: '',
  busy: false,
  error: '',
})

/** Mỗi hộp thoại mở ra thì đưa tiêu điểm vào ô nhập đầu tiên: người dùng bàn
 *  phím không phải tab xuyên qua cả trang phía sau lớp phủ mới tới được nó. */
function focusFirstField(id: string) {
  nextTick(() => (document.getElementById(id) as HTMLInputElement | null)?.focus())
}

function openEnroll(type: FactorType) {
  Object.assign(enrollDialog, {
    open: true, factorType: type, stage: 'password',
    currentPassword: '', secondPassword: '', secondPasswordConfirm: '',
    totpSecret: '', otpauthUri: '', sentTo: '', code: '', busy: false, error: '',
  })
  focusFirstField('enroll-pw')
}

function closeEnroll() {
  enrollDialog.open = false
  // Bí mật TOTP chỉ hiện một lần; xoá khỏi bộ nhớ trang ngay khi đóng.
  enrollDialog.totpSecret = ''
  enrollDialog.otpauthUri = ''
  enrollDialog.currentPassword = ''
  enrollDialog.secondPassword = ''
  enrollDialog.secondPasswordConfirm = ''
  enrollDialog.code = ''
}

/** QR sinh phía client bằng API công khai của Google Charts thì rò URI chứa bí mật
 *  ra bên thứ ba, nên ở đây chỉ hiện chuỗi bí mật để nhập tay + link otpauth://
 *  cho ứng dụng trên cùng thiết bị. */
const otpauthLink = computed(() => enrollDialog.otpauthUri)

async function submitEnroll() {
  enrollDialog.error = ''
  if (!enrollDialog.currentPassword) {
    enrollDialog.error = 'Vui lòng nhập mật khẩu hiện tại.'
    return
  }
  if (enrollDialog.factorType === 'second_password') {
    if (!enrollDialog.secondPassword) {
      enrollDialog.error = 'Vui lòng nhập mật khẩu cấp 2.'
      return
    }
    if (enrollDialog.secondPassword !== enrollDialog.secondPasswordConfirm) {
      enrollDialog.error = 'Mật khẩu cấp 2 và ô nhập lại không khớp.'
      return
    }
  }
  enrollDialog.busy = true
  try {
    const res = await $fetch<{ ok: boolean; secret?: string; otpauthUri?: string; sentTo?: string }>(
      '/api/admin/profile/mfa/enroll',
      {
        method: 'POST',
        body: {
          factorType: enrollDialog.factorType,
          currentPassword: enrollDialog.currentPassword,
          ...(enrollDialog.factorType === 'second_password' ? { secondPassword: enrollDialog.secondPassword } : {}),
        },
      },
    )
    enrollDialog.totpSecret = res.secret || ''
    enrollDialog.otpauthUri = res.otpauthUri || ''
    enrollDialog.sentTo = res.sentTo || ''
    enrollDialog.stage = 'confirm'
    // Bước 2 thay hẳn nội dung hộp thoại, nên tiêu điểm phải đi theo.
    focusFirstField(enrollDialog.factorType === 'second_password' ? 'enroll-sp-confirm' : 'enroll-code')
  } catch (err: any) {
    enrollDialog.error = err?.data?.statusMessage || 'Không bắt đầu được việc bật xác thực.'
  } finally {
    enrollDialog.busy = false
  }
}

async function submitConfirm() {
  enrollDialog.error = ''
  const needsCode = enrollDialog.factorType !== 'second_password'
  const value = needsCode ? enrollDialog.code.trim() : enrollDialog.secondPassword
  if (!value) {
    enrollDialog.error = needsCode ? 'Vui lòng nhập mã xác thực.' : 'Vui lòng nhập lại mật khẩu cấp 2.'
    return
  }
  enrollDialog.busy = true
  try {
    const res = await $fetch<{ ok: boolean; message: string }>('/api/admin/profile/mfa/confirm', {
      method: 'POST',
      body: { factorType: enrollDialog.factorType, code: value },
    })
    toast.success(res.message || 'Đã bật xác thực hai bước.')
    closeEnroll()
    await Promise.all([loadMfa(), loadHistory()])
  } catch (err: any) {
    enrollDialog.error = err?.data?.statusMessage || 'Mã không đúng.'
    if (needsCode) enrollDialog.code = ''
  } finally {
    enrollDialog.busy = false
  }
}

async function resendEnrollCode() {
  enrollDialog.error = ''
  enrollDialog.busy = true
  try {
    // Gửi lại bằng cách chạy lại bước enroll: server thay mã cũ bằng mã mới.
    const res = await $fetch<{ ok: boolean; sentTo?: string }>('/api/admin/profile/mfa/enroll', {
      method: 'POST',
      body: { factorType: 'email_otp', currentPassword: enrollDialog.currentPassword },
    })
    enrollDialog.sentTo = res.sentTo || enrollDialog.sentTo
    toast.info('Đã gửi lại mã mới. Mã cũ không còn dùng được.')
  } catch (err: any) {
    enrollDialog.error = err?.data?.statusMessage || 'Không gửi lại được mã.'
  } finally {
    enrollDialog.busy = false
  }
}

// ── Tắt một yếu tố ───────────────────────────────────────────────────────────
const disableDialog = reactive({
  open: false,
  factorType: 'totp' as FactorType,
  currentPassword: '',
  busy: false,
  error: '',
})

function openDisable(type: FactorType) {
  Object.assign(disableDialog, { open: true, factorType: type, currentPassword: '', busy: false, error: '' })
  focusFirstField('disable-pw')
}

function closeDisable() {
  disableDialog.open = false
  disableDialog.currentPassword = ''
}

async function submitDisable() {
  disableDialog.error = ''
  if (!disableDialog.currentPassword) {
    disableDialog.error = 'Vui lòng nhập mật khẩu hiện tại.'
    return
  }
  disableDialog.busy = true
  try {
    const res = await $fetch<{ ok: boolean; message: string }>('/api/admin/profile/mfa/disable', {
      method: 'POST',
      body: { factorType: disableDialog.factorType, currentPassword: disableDialog.currentPassword },
    })
    toast.success(res.message || 'Đã tắt yếu tố xác thực.')
    disableDialog.open = false
    disableDialog.currentPassword = ''
    await Promise.all([loadMfa(), loadHistory()])
  } catch (err: any) {
    disableDialog.error = err?.data?.statusMessage || 'Không tắt được yếu tố xác thực.'
  } finally {
    disableDialog.busy = false
  }
}

// ── Mã dự phòng ──────────────────────────────────────────────────────────────
const recoveryDialog = reactive({
  open: false,
  mode: 'create' as 'create' | 'delete',
  currentPassword: '',
  busy: false,
  error: '',
})
// Chỉ tồn tại trong bộ nhớ trang, đúng một lần, ngay sau khi sinh.
const revealedCodes = ref<string[]>([])

function openRecovery(mode: 'create' | 'delete') {
  Object.assign(recoveryDialog, { open: true, mode, currentPassword: '', busy: false, error: '' })
  focusFirstField('recovery-pw')
}

function closeRecovery() {
  recoveryDialog.open = false
  recoveryDialog.currentPassword = ''
}

async function submitRecovery() {
  recoveryDialog.error = ''
  if (!recoveryDialog.currentPassword) {
    recoveryDialog.error = 'Vui lòng nhập mật khẩu hiện tại.'
    return
  }
  recoveryDialog.busy = true
  try {
    if (recoveryDialog.mode === 'create') {
      const res = await $fetch<{ ok: boolean; codes: string[]; message?: string }>('/api/admin/profile/mfa/recovery-codes', {
        method: 'POST',
        body: { currentPassword: recoveryDialog.currentPassword },
      })
      revealedCodes.value = res.codes ?? []
      toast.success('Đã tạo mã dự phòng mới. Lưu lại ngay — sẽ không hiện lại.')
    } else {
      const res = await $fetch<{ ok: boolean; message: string }>('/api/admin/profile/mfa/recovery-codes', {
        method: 'DELETE',
        body: { currentPassword: recoveryDialog.currentPassword },
      })
      revealedCodes.value = []
      toast.success(res.message || 'Đã tắt mã dự phòng.')
    }
    recoveryDialog.open = false
    recoveryDialog.currentPassword = ''
    await loadMfa()
  } catch (err: any) {
    recoveryDialog.error = err?.data?.statusMessage || 'Không thực hiện được.'
  } finally {
    recoveryDialog.busy = false
  }
}

async function copyCodes() {
  try {
    await navigator.clipboard.writeText(revealedCodes.value.join('\n'))
    toast.success('Đã copy toàn bộ mã dự phòng.')
  } catch {
    toast.error('Trình duyệt không cho copy. Vui lòng chọn và copy thủ công.')
  }
}

function downloadCodes() {
  const body = [
    'Mã dự phòng — Con Đường Hướng Thiện (Admin)',
    `Tài khoản: ${user.value?.username ?? ''}`,
    `Tạo lúc: ${new Date().toLocaleString('vi-VN')}`,
    'Mỗi mã chỉ dùng được MỘT lần. Giữ tệp này ở nơi an toàn.',
    '',
    ...revealedCodes.value,
  ].join('\n')
  const url = URL.createObjectURL(new Blob([body], { type: 'text/plain;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `ma-du-phong-${user.value?.username ?? 'admin'}.txt`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Lịch sử truy cập & hoạt động ─────────────────────────────────────────────
// Khối này sống trong `ProfileActivityHistory.vue`. Trang cha chỉ giữ `ref` để
// làm mới danh sách sau khi bật/tắt một yếu tố — hai thao tác đó tự ghi thêm
// một dòng vào chính bảng đang hiển thị, và không làm mới thì người dùng nhìn
// vào một danh sách thiếu đúng dòng họ vừa tạo ra.
const historyRef = ref<{ reload: () => void } | null>(null)
function loadHistory() { historyRef.value?.reload() }

/** Escape đóng hộp thoại đang mở — cùng cách làm với ConfirmModal. Bắt ở window
 *  vì tiêu điểm có thể đang nằm trên nút đóng hay một ô nhập bất kỳ bên trong
 *  hộp thoại. Hộp thoại đang bận gọi API thì không đóng, để không bỏ dở một
 *  thao tác đã gửi đi. Không bắt Enter: mỗi ô nhập đã tự nối @keyup.enter tới
 *  đúng bước của nó, còn ở đây thì không biết đang ở bước nào. */
function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (enrollDialog.open && !enrollDialog.busy) return closeEnroll()
  if (disableDialog.open && !disableDialog.busy) return closeDisable()
  if (recoveryDialog.open && !recoveryDialog.busy) return closeRecovery()
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  await loadMfa()
})

onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- Header -->
    <div>
      <h1 class="text-[1.3rem] font-extrabold text-[#122815] m-0">Tài khoản của tôi</h1>
      <p class="text-[0.85rem] text-[#667768] mt-1 mb-0">
        Đổi mật khẩu, bật xác thực hai bước và xem lịch sử truy cập của chính bạn.
      </p>
    </div>

    <!-- Thông tin tài khoản -->
    <div class="rounded-xl border border-[#e2ece3] bg-white p-5 flex items-center gap-4 flex-wrap">
      <div class="w-12 h-12 rounded-full bg-[#2c6e33] text-white flex items-center justify-center font-extrabold text-lg shrink-0">
        {{ (user?.username || '?').charAt(0).toUpperCase() }}
      </div>
      <div class="min-w-0">
        <div class="text-[1rem] font-extrabold text-[#122815]">{{ user?.username }}</div>
        <div class="text-[0.82rem] text-[#667768]">
          {{ user?.isSuperAdmin ? 'SuperAdmin (Toàn quyền)' : (user?.roleName || 'Chưa gán vai trò') }}
          <template v-if="mfa?.email"> · {{ mfa.email }}</template>
        </div>
      </div>
      <div class="ml-auto flex items-center gap-2 text-[0.78rem] font-bold px-3 py-1.5 rounded-full border"
           :class="activeFactors.length > 0
             ? 'bg-[#eef7ee] border-[#cce5cd] text-[#1e4620]'
             : 'bg-[#fdf6e7] border-[#f0dcae] text-[#8a6412]'">
        <i class="fa-solid" :class="activeFactors.length > 0 ? 'fa-shield-halved' : 'fa-shield'" aria-hidden="true"></i>
        <span>{{ activeFactors.length > 0 ? `Đã bật ${activeFactors.length} yếu tố thứ hai` : 'Chưa bật xác thực hai bước' }}</span>
      </div>
    </div>

    <!-- ── Đổi mật khẩu ──────────────────────────────────────────────── -->
    <section class="rounded-xl border border-[#e2ece3] bg-white p-5">
      <div class="flex items-center gap-3 mb-4">
        <span class="w-1 h-5 rounded-full bg-[#2c6e33]" aria-hidden="true"></span>
        <h2 class="text-[1rem] font-extrabold text-[#122815] m-0">Đổi mật khẩu</h2>
      </div>
      <p class="text-[0.82rem] text-[#667768] mt-0 mb-4">
        Tối thiểu 12 ký tự, có đủ 3 trong 4 nhóm (chữ thường, chữ hoa, số, ký tự đặc biệt) và không chứa tên đăng nhập.
        Sau khi đổi, các phiên đăng nhập khác sẽ bị thu hồi.
      </p>

      <div v-if="pwError" class="flex items-start gap-2 bg-[#ffebe9] border border-[#ffc1ba] text-[#d12420] px-3.5 py-2.5 rounded-lg text-[0.84rem] mb-4" role="alert">
        <i class="fa-solid fa-triangle-exclamation shrink-0 mt-0.5" aria-hidden="true"></i>
        <span>{{ pwError }}</span>
      </div>

      <form class="grid grid-cols-1 md:grid-cols-3 gap-3" @submit.prevent="changePassword">
        <div>
          <label for="pw-current" class="block text-[0.8rem] font-bold text-[#2c3e2e] mb-1.5">Mật khẩu hiện tại</label>
          <input id="pw-current" v-model="pw.current" type="password" autocomplete="current-password"
                 class="w-full px-3 py-2.5 rounded-lg border border-[#c8d6c9] text-[0.9rem] outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15" />
        </div>
        <div>
          <label for="pw-next" class="block text-[0.8rem] font-bold text-[#2c3e2e] mb-1.5">Mật khẩu mới</label>
          <input id="pw-next" v-model="pw.next" type="password" autocomplete="new-password"
                 class="w-full px-3 py-2.5 rounded-lg border border-[#c8d6c9] text-[0.9rem] outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15" />
        </div>
        <div>
          <label for="pw-confirm" class="block text-[0.8rem] font-bold text-[#2c3e2e] mb-1.5">Nhập lại mật khẩu mới</label>
          <input id="pw-confirm" v-model="pw.confirm" type="password" autocomplete="new-password"
                 class="w-full px-3 py-2.5 rounded-lg border border-[#c8d6c9] text-[0.9rem] outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15" />
        </div>
        <div class="md:col-span-3">
          <button type="submit" :disabled="pwSaving"
                  class="inline-flex items-center gap-2 rounded-lg bg-[#1e4620] hover:bg-[#2c6e33] px-4 py-2.5 text-sm font-bold text-white border-0 cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[#2c6e33] focus:ring-offset-2">
            <i class="fa-solid" :class="pwSaving ? 'fa-spinner fa-spin' : 'fa-key'" aria-hidden="true"></i>
            {{ pwSaving ? 'Đang đổi…' : 'Đổi mật khẩu' }}
          </button>
        </div>
      </form>
    </section>

    <!-- ── Xác thực hai bước ─────────────────────────────────────────── -->
    <section class="rounded-xl border border-[#e2ece3] bg-white p-5">
      <div class="flex items-center gap-3 mb-4">
        <span class="w-1 h-5 rounded-full bg-[#2c6e33]" aria-hidden="true"></span>
        <h2 class="text-[1rem] font-extrabold text-[#122815] m-0">Xác thực hai bước</h2>
      </div>
      <p class="text-[0.82rem] text-[#667768] mt-0 mb-4">
        Tự nguyện — bật cái nào cũng được, bật nhiều cái thì lúc đăng nhập chỉ cần vượt qua một trong số đó.
        Bật hoặc tắt sẽ thu hồi các phiên đăng nhập khác.
      </p>

      <!-- Loading — three factor cards, the shape the list below always renders -->
      <div v-if="mfaLoading" class="flex flex-col gap-3" role="status" aria-busy="true">
        <span class="sr-only">Đang tải trạng thái xác thực hai bước</span>
        <div
          v-for="n in 3"
          :key="'mf-' + n"
          class="rounded-xl border border-[#e2ece3] bg-white p-4 flex items-start gap-4 flex-wrap"
          aria-hidden="true"
        >
          <div class="w-10 h-10 rounded-xl bg-[#dfe9e0] animate-pulse motion-reduce:animate-none shrink-0"></div>
          <div class="flex-1 min-w-[220px] flex flex-col gap-2">
            <div class="flex items-center gap-2">
              <div class="h-4 w-44 rounded bg-[#dfe9e0] animate-pulse motion-reduce:animate-none"></div>
              <div class="h-4 w-24 rounded-full bg-[#edf3ed] animate-pulse motion-reduce:animate-none"></div>
            </div>
            <div class="h-3 w-full max-w-[420px] rounded bg-[#edf3ed] animate-pulse motion-reduce:animate-none"></div>
          </div>
          <div class="h-9 w-28 rounded-lg bg-[#edf3ed] animate-pulse motion-reduce:animate-none"></div>
        </div>
      </div>

      <!-- Error -->
      <div v-else-if="mfaError" class="flex items-start gap-2 bg-[#ffebe9] border border-[#ffc1ba] text-[#d12420] px-3.5 py-3 rounded-lg text-[0.84rem]" role="alert">
        <i class="fa-solid fa-triangle-exclamation shrink-0 mt-0.5" aria-hidden="true"></i>
        <div>
          <div>{{ mfaError }}</div>
          <button type="button" class="mt-2 text-[0.82rem] font-bold underline bg-transparent border-0 cursor-pointer text-[#d12420] rounded focus:outline-none focus:ring-2 focus:ring-[#d12420]/40" @click="loadMfa">Thử lại</button>
        </div>
      </div>

      <template v-else-if="mfa">
        <!-- Cảnh báo nguy cơ mất quyền truy cập -->
        <div v-if="mfa.lockoutRisk" class="flex items-start gap-2.5 bg-[#fdf6e7] border border-[#f0dcae] text-[#8a6412] px-3.5 py-3 rounded-lg text-[0.84rem] mb-4" role="alert">
          <i class="fa-solid fa-triangle-exclamation shrink-0 mt-0.5" aria-hidden="true"></i>
          <span>
            Bạn đã bật xác thực hai bước nhưng <strong>không có cách dự phòng nào</strong>. Mất thiết bị là mất quyền vào hệ thống —
            chỉ quản trị viên cấp cao mới mở lại được. Nên tạo mã dự phòng hoặc bật thêm mã OTP qua email.
          </span>
        </div>

        <div class="flex flex-col gap-3">
          <div
            v-for="f in mfa.factors"
            :key="f.factorType"
            class="rounded-xl border p-4 flex items-start gap-4 flex-wrap"
            :class="f.state === 'active' ? 'border-[#cce5cd] bg-[#fafcfa]' : 'border-[#e2ece3] bg-white'"
          >
            <div class="w-10 h-10 rounded-xl bg-[#f0f7f1] border border-[#e2ece3] flex items-center justify-center shrink-0">
              <i :class="FACTOR_META[f.factorType].icon" class="text-[#2c6e33]" aria-hidden="true"></i>
            </div>
            <div class="flex-1 min-w-[220px]">
              <div class="flex items-center gap-2 flex-wrap">
                <strong class="text-[0.9rem] text-[#122815]">{{ FACTOR_META[f.factorType].label }}</strong>
                <!-- Trạng thái mang cả icon + chữ, không chỉ dựa vào màu -->
                <span
                  class="inline-flex items-center gap-1 text-[0.7rem] font-bold px-2 py-0.5 rounded-full border"
                  :class="f.state === 'active'
                    ? 'bg-[#eef7ee] border-[#cce5cd] text-[#1e4620]'
                    : f.state === 'pending'
                      ? 'bg-[#fdf6e7] border-[#f0dcae] text-[#8a6412]'
                      : 'bg-[#f4f7f4] border-[#dce8dd] text-[#667768]'"
                >
                  <i class="fa-solid" :class="f.state === 'active' ? 'fa-circle-check' : f.state === 'pending' ? 'fa-clock' : 'fa-circle-minus'" aria-hidden="true"></i>
                  {{ f.state === 'active' ? 'Đang bật' : f.state === 'pending' ? 'Chờ xác nhận' : 'Đang tắt' }}
                </span>
                <span v-if="f.state === 'active' && !f.usable"
                      class="inline-flex items-center gap-1 text-[0.7rem] font-bold px-2 py-0.5 rounded-full border bg-[#ffebe9] border-[#ffc1ba] text-[#d12420]">
                  <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
                  Không dùng được
                </span>
              </div>
              <p class="text-[0.8rem] text-[#667768] mt-1 mb-0">{{ FACTOR_META[f.factorType].desc }}</p>
              <p v-if="f.state === 'active' && !f.usable" class="text-[0.78rem] text-[#d12420] mt-1.5 mb-0">
                Bí mật lưu trữ không giải mã được (thường do khóa JWT_SECRET đã bị đổi). Hãy tắt rồi bật lại yếu tố này.
              </p>
              <p v-if="f.factorType === 'email_otp' && !canEnroll('email_otp')" class="text-[0.78rem] text-[#8a6412] mt-1.5 mb-0">
                <i class="fa-solid fa-circle-info mr-1" aria-hidden="true"></i>
                <template v-if="!mfa.email">Tài khoản chưa có email — cần bổ sung email trước.</template>
                <template v-else>Chưa cấu hình SMTP nên chưa gửi được mã. Cấu hình tại Cài đặt → Cấu hình Email.</template>
              </p>
              <p v-if="f.lastUsedAt" class="text-[0.75rem] text-[#8ea98f] mt-1.5 mb-0">
                Dùng lần cuối: {{ formatDateTimeVN(f.lastUsedAt) }}
              </p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <button
                v-if="f.state !== 'active'"
                type="button"
                :disabled="!canEnroll(f.factorType)"
                class="inline-flex items-center gap-2 rounded-lg bg-[#1e4620] hover:bg-[#2c6e33] px-3.5 py-2 text-[0.84rem] font-bold text-white border-0 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[#2c6e33] focus:ring-offset-2"
                @click="openEnroll(f.factorType)"
              >
                <i class="fa-solid fa-plus" aria-hidden="true"></i>
                {{ f.state === 'pending' ? 'Tiếp tục bật' : 'Bật' }}
              </button>
              <button
                v-else
                type="button"
                class="inline-flex items-center gap-2 rounded-lg border border-[#e2ece3] bg-white px-3.5 py-2 text-[0.84rem] font-semibold text-[#d12420] hover:bg-red-50 cursor-pointer focus:outline-none focus:ring-2 focus:ring-red-400"
                @click="openDisable(f.factorType)"
              >
                <i class="fa-solid fa-power-off" aria-hidden="true"></i>
                Tắt
              </button>
            </div>
          </div>
        </div>

        <!-- Mã dự phòng -->
        <div class="mt-5 rounded-xl border border-[#e2ece3] bg-[#fafcfa] p-4">
          <div class="flex items-start gap-4 flex-wrap">
            <div class="w-10 h-10 rounded-xl bg-[#f0f7f1] border border-[#e2ece3] flex items-center justify-center shrink-0">
              <i class="fa-solid fa-life-ring text-[#2c6e33]" aria-hidden="true"></i>
            </div>
            <div class="flex-1 min-w-[220px]">
              <div class="flex items-center gap-2 flex-wrap">
                <strong class="text-[0.9rem] text-[#122815]">Mã dự phòng</strong>
                <span class="inline-flex items-center gap-1 text-[0.7rem] font-bold px-2 py-0.5 rounded-full border"
                      :class="mfa.recoveryCodesEnabled ? 'bg-[#eef7ee] border-[#cce5cd] text-[#1e4620]' : 'bg-[#f4f7f4] border-[#dce8dd] text-[#667768]'">
                  <i class="fa-solid" :class="mfa.recoveryCodesEnabled ? 'fa-circle-check' : 'fa-circle-minus'" aria-hidden="true"></i>
                  {{ mfa.recoveryCodesEnabled ? `Còn ${mfa.recoveryCodesRemaining} mã` : 'Đang tắt' }}
                </span>
              </div>
              <p class="text-[0.8rem] text-[#667768] mt-1 mb-0">
                10 mã dùng một lần, để vào được hệ thống khi mất thiết bị xác thực. Tuỳ chọn — bật/tắt lúc nào cũng được.
              </p>
              <p v-if="activeFactors.length === 0" class="text-[0.78rem] text-[#8a6412] mt-1.5 mb-0">
                <i class="fa-solid fa-circle-info mr-1" aria-hidden="true"></i>
                Cần bật ít nhất một yếu tố thứ hai trước khi tạo mã dự phòng.
              </p>
            </div>
            <div class="flex items-center gap-2 shrink-0 flex-wrap">
              <button type="button" :disabled="activeFactors.length === 0"
                      class="inline-flex items-center gap-2 rounded-lg bg-[#1e4620] hover:bg-[#2c6e33] px-3.5 py-2 text-[0.84rem] font-bold text-white border-0 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[#2c6e33] focus:ring-offset-2"
                      @click="openRecovery('create')">
                <i class="fa-solid fa-rotate" aria-hidden="true"></i>
                {{ mfa.recoveryCodesEnabled ? 'Tạo lại mã' : 'Tạo mã dự phòng' }}
              </button>
              <button v-if="mfa.recoveryCodesEnabled" type="button"
                      class="inline-flex items-center gap-2 rounded-lg border border-[#e2ece3] bg-white px-3.5 py-2 text-[0.84rem] font-semibold text-[#d12420] hover:bg-red-50 cursor-pointer focus:outline-none focus:ring-2 focus:ring-red-400"
                      @click="openRecovery('delete')">
                <i class="fa-solid fa-trash" aria-hidden="true"></i>
                Tắt
              </button>
            </div>
          </div>

          <!-- Hiện mã đúng một lần -->
          <div v-if="revealedCodes.length" class="mt-4 rounded-lg border border-[#f0dcae] bg-[#fdf6e7] p-4">
            <div class="flex items-start gap-2 text-[0.84rem] font-bold text-[#8a6412] mb-3">
              <i class="fa-solid fa-triangle-exclamation shrink-0 mt-0.5" aria-hidden="true"></i>
              <span>Lưu lại ngay — các mã này chỉ hiện một lần duy nhất và sẽ không xem lại được.</span>
            </div>
            <ul class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 list-none p-0 m-0">
              <li v-for="c in revealedCodes" :key="c"
                  class="rounded-lg border border-[#e2ece3] bg-white px-2.5 py-2 text-center font-mono text-[0.85rem] font-bold text-[#122815] tracking-wide">
                {{ c }}
              </li>
            </ul>
            <div class="flex items-center gap-2 mt-3 flex-wrap">
              <button type="button" class="inline-flex items-center gap-2 rounded-lg border border-[#2c6e33] bg-white px-3.5 py-2 text-[0.84rem] font-bold text-[#2c6e33] hover:bg-[#f0f7f1] cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#2c6e33]" @click="copyCodes">
                <i class="fa-solid fa-copy" aria-hidden="true"></i>
                Copy toàn bộ
              </button>
              <button type="button" class="inline-flex items-center gap-2 rounded-lg border border-[#2c6e33] bg-white px-3.5 py-2 text-[0.84rem] font-bold text-[#2c6e33] hover:bg-[#f0f7f1] cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#2c6e33]" @click="downloadCodes">
                <i class="fa-solid fa-download" aria-hidden="true"></i>
                Tải về tệp .txt
              </button>
              <button type="button" class="inline-flex items-center gap-2 rounded-lg bg-transparent border-0 px-2 py-2 text-[0.84rem] font-semibold text-[#667768] hover:text-[#2c6e33] cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#2c6e33] rounded-lg" @click="revealedCodes = []">
                Tôi đã lưu, ẩn đi
              </button>
            </div>
          </div>
        </div>
      </template>
    </section>

    <!-- ── Lịch sử truy cập & hoạt động ──────────────────────────────── -->
    <!-- Bật/tắt một yếu tố ghi thêm một dòng vào bảng này, nên trang cha giữ
         `ref` để gọi `reload()` sau hai thao tác đó. -->
    <ProfileActivityHistory ref="historyRef" />

    <!-- ── Modal: bật một yếu tố ─────────────────────────────────────── -->
    <div v-if="enrollDialog.open" class="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto" @click.self="closeEnroll">
      <div class="w-full max-w-lg rounded-xl bg-white shadow-xl mt-10" role="dialog" aria-modal="true" aria-labelledby="enroll-title">
        <div class="flex items-center gap-3 px-5 py-4 border-b border-[#e2ece3]">
          <i :class="FACTOR_META[enrollDialog.factorType].icon" class="text-[#2c6e33]" aria-hidden="true"></i>
          <h3 id="enroll-title" class="text-[0.95rem] font-extrabold text-[#122815] m-0 flex-1">
            Bật {{ FACTOR_META[enrollDialog.factorType].label }}
          </h3>
          <button type="button" aria-label="Đóng"
                  class="w-8 h-8 rounded-lg border-0 bg-transparent text-[#667768] hover:bg-[#f0f7f1] cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#2c6e33]"
                  @click="closeEnroll">
            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
          </button>
        </div>

        <div class="px-5 py-4 flex flex-col gap-3.5">
          <div v-if="enrollDialog.error" class="flex items-start gap-2 bg-[#ffebe9] border border-[#ffc1ba] text-[#d12420] px-3.5 py-2.5 rounded-lg text-[0.84rem]" role="alert">
            <i class="fa-solid fa-triangle-exclamation shrink-0 mt-0.5" aria-hidden="true"></i>
            <span>{{ enrollDialog.error }}</span>
          </div>

          <!-- Bước 1: xác nhận mật khẩu hiện tại -->
          <template v-if="enrollDialog.stage === 'password'">
            <p class="text-[0.83rem] text-[#667768] m-0">
              {{ FACTOR_META[enrollDialog.factorType].desc }}
              Nhập mật khẩu hiện tại để xác nhận đây đúng là bạn.
            </p>
            <div>
              <label for="enroll-pw" class="block text-[0.82rem] font-semibold text-[#3d4a3e] mb-1.5">Mật khẩu hiện tại</label>
              <input id="enroll-pw" v-model="enrollDialog.currentPassword" type="password" autocomplete="current-password"
                     class="w-full rounded-lg border border-[#e2ece3] px-3.5 py-2.5 text-[0.88rem] text-[#122815] focus:outline-none focus:ring-2 focus:ring-[#2c6e33] focus:border-[#2c6e33]"
                     @keyup.enter="submitEnroll" />
            </div>
            <template v-if="enrollDialog.factorType === 'second_password'">
              <div>
                <label for="enroll-sp" class="block text-[0.82rem] font-semibold text-[#3d4a3e] mb-1.5">Mật khẩu cấp 2</label>
                <input id="enroll-sp" v-model="enrollDialog.secondPassword" type="password" autocomplete="new-password"
                       class="w-full rounded-lg border border-[#e2ece3] px-3.5 py-2.5 text-[0.88rem] text-[#122815] focus:outline-none focus:ring-2 focus:ring-[#2c6e33] focus:border-[#2c6e33]" />
                <p class="text-[0.76rem] text-[#8ea98f] mt-1.5 mb-0">
                  Cùng yêu cầu độ mạnh như mật khẩu đăng nhập, và phải khác mật khẩu đăng nhập.
                </p>
              </div>
              <div>
                <label for="enroll-sp2" class="block text-[0.82rem] font-semibold text-[#3d4a3e] mb-1.5">Nhập lại mật khẩu cấp 2</label>
                <input id="enroll-sp2" v-model="enrollDialog.secondPasswordConfirm" type="password" autocomplete="new-password"
                       class="w-full rounded-lg border border-[#e2ece3] px-3.5 py-2.5 text-[0.88rem] text-[#122815] focus:outline-none focus:ring-2 focus:ring-[#2c6e33] focus:border-[#2c6e33]"
                       @keyup.enter="submitEnroll" />
              </div>
            </template>
          </template>

          <!-- Bước 2: xác nhận -->
          <template v-else>
            <!-- TOTP: hiện bí mật để nhập tay, không sinh QR qua bên thứ ba -->
            <template v-if="enrollDialog.factorType === 'totp'">
              <p class="text-[0.83rem] text-[#667768] m-0">
                Mở Google Authenticator (hoặc app tương tự) → <strong>Thêm tài khoản</strong> → <strong>Nhập khoá thủ công</strong>,
                rồi dán chuỗi dưới đây.
              </p>
              <div class="flex items-start gap-2 bg-[#fdf6e7] border border-[#f0dcae] text-[#8a6412] px-3.5 py-2.5 rounded-lg text-[0.82rem]" role="alert">
                <i class="fa-solid fa-triangle-exclamation shrink-0 mt-0.5" aria-hidden="true"></i>
                <span>Chuỗi này chỉ hiện <strong>một lần</strong>. Đóng cửa sổ mà chưa thêm vào app thì phải bật lại từ đầu.</span>
              </div>
              <div class="rounded-lg border border-[#e2ece3] bg-[#fafcfa] px-3.5 py-3">
                <div class="text-[0.74rem] font-bold text-[#667768] uppercase tracking-wide mb-1">Khoá bí mật</div>
                <code class="block font-mono text-[0.95rem] font-bold text-[#122815] break-all leading-relaxed">{{ enrollDialog.totpSecret }}</code>
                <a v-if="otpauthLink" :href="otpauthLink"
                   class="inline-flex items-center gap-2 mt-2.5 text-[0.8rem] font-bold text-[#2c6e33] no-underline hover:underline focus:outline-none focus:ring-2 focus:ring-[#2c6e33] rounded">
                  <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>
                  Mở bằng app trên thiết bị này
                </a>
              </div>
            </template>

            <!-- Email OTP -->
            <template v-else-if="enrollDialog.factorType === 'email_otp'">
              <p class="text-[0.83rem] text-[#667768] m-0" role="status">
                Đã gửi mã 6 số tới <strong>{{ enrollDialog.sentTo || mfa?.email }}</strong>. Mã sống 10 phút.
              </p>
              <button type="button" :disabled="enrollDialog.busy"
                      class="self-start inline-flex items-center gap-2 rounded-lg border border-[#e2ece3] bg-white px-3 py-2 text-[0.82rem] font-semibold text-[#2c6e33] hover:bg-[#f0f7f1] cursor-pointer disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#2c6e33]"
                      @click="resendEnrollCode">
                <i class="fa-solid fa-paper-plane" aria-hidden="true"></i>
                Gửi lại mã
              </button>
            </template>

            <p v-else class="text-[0.83rem] text-[#667768] m-0">
              Nhập lại mật khẩu cấp 2 một lần nữa để chắc chắn bạn đã ghi nhớ đúng.
            </p>

            <div v-if="enrollDialog.factorType !== 'second_password'">
              <label for="enroll-code" class="block text-[0.82rem] font-semibold text-[#3d4a3e] mb-1.5">Mã xác thực</label>
              <input id="enroll-code" v-model="enrollDialog.code" type="text" inputmode="numeric"
                     autocomplete="one-time-code" maxlength="8"
                     class="w-full rounded-lg border border-[#e2ece3] px-3.5 py-2.5 text-[1rem] font-mono tracking-[0.3em] text-[#122815] focus:outline-none focus:ring-2 focus:ring-[#2c6e33] focus:border-[#2c6e33]"
                     @keyup.enter="submitConfirm" />
            </div>
            <div v-else>
              <label for="enroll-sp-confirm" class="block text-[0.82rem] font-semibold text-[#3d4a3e] mb-1.5">Mật khẩu cấp 2</label>
              <input id="enroll-sp-confirm" v-model="enrollDialog.secondPassword" type="password" autocomplete="off"
                     class="w-full rounded-lg border border-[#e2ece3] px-3.5 py-2.5 text-[0.88rem] text-[#122815] focus:outline-none focus:ring-2 focus:ring-[#2c6e33] focus:border-[#2c6e33]"
                     @keyup.enter="submitConfirm" />
            </div>

            <p class="text-[0.78rem] text-[#8ea98f] m-0">
              <i class="fa-solid fa-circle-info mr-1" aria-hidden="true"></i>
              Bật xong, các phiên đăng nhập khác sẽ bị thu hồi — phiên hiện tại vẫn giữ.
            </p>
          </template>
        </div>

        <div class="flex items-center justify-end gap-2 px-5 py-4 border-t border-[#e2ece3]">
          <button type="button" class="rounded-lg border border-[#e2ece3] bg-white px-3.5 py-2 text-[0.84rem] font-semibold text-[#3d4a3e] hover:bg-[#f0f7f1] cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#2c6e33]" @click="closeEnroll">
            Huỷ
          </button>
          <button type="button" :disabled="enrollDialog.busy"
                  class="inline-flex items-center gap-2 rounded-lg bg-[#1e4620] hover:bg-[#2c6e33] px-4 py-2 text-[0.84rem] font-bold text-white border-0 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[#2c6e33] focus:ring-offset-2"
                  @click="enrollDialog.stage === 'password' ? submitEnroll() : submitConfirm()">
            <i v-if="enrollDialog.busy" class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>
            {{ enrollDialog.stage === 'password' ? 'Tiếp tục' : 'Xác nhận bật' }}
          </button>
        </div>
      </div>
    </div>

    <!-- ── Modal: tắt một yếu tố ─────────────────────────────────────── -->
    <div v-if="disableDialog.open" class="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto" @click.self="closeDisable">
      <div class="w-full max-w-md rounded-xl bg-white shadow-xl mt-16" role="dialog" aria-modal="true" aria-labelledby="disable-title">
        <div class="flex items-center gap-3 px-5 py-4 border-b border-[#e2ece3]">
          <i class="fa-solid fa-shield-halved text-[#d12420]" aria-hidden="true"></i>
          <h3 id="disable-title" class="text-[0.95rem] font-extrabold text-[#122815] m-0 flex-1">
            Tắt {{ FACTOR_META[disableDialog.factorType].label }}
          </h3>
          <button type="button" aria-label="Đóng"
                  class="w-8 h-8 rounded-lg border-0 bg-transparent text-[#667768] hover:bg-[#f0f7f1] cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#2c6e33]"
                  @click="closeDisable">
            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
          </button>
        </div>
        <div class="px-5 py-4 flex flex-col gap-3.5">
          <div v-if="disableDialog.error" class="flex items-start gap-2 bg-[#ffebe9] border border-[#ffc1ba] text-[#d12420] px-3.5 py-2.5 rounded-lg text-[0.84rem]" role="alert">
            <i class="fa-solid fa-triangle-exclamation shrink-0 mt-0.5" aria-hidden="true"></i>
            <span>{{ disableDialog.error }}</span>
          </div>
          <p class="text-[0.83rem] text-[#667768] m-0">
            Tắt yếu tố này thì tài khoản của bạn sẽ giảm một lớp bảo vệ. Nhập mật khẩu hiện tại để xác nhận.
          </p>
          <div>
            <label for="disable-pw" class="block text-[0.82rem] font-semibold text-[#3d4a3e] mb-1.5">Mật khẩu hiện tại</label>
            <input id="disable-pw" v-model="disableDialog.currentPassword" type="password" autocomplete="current-password"
                   class="w-full rounded-lg border border-[#e2ece3] px-3.5 py-2.5 text-[0.88rem] text-[#122815] focus:outline-none focus:ring-2 focus:ring-[#2c6e33] focus:border-[#2c6e33]"
                   @keyup.enter="submitDisable" />
          </div>
        </div>
        <div class="flex items-center justify-end gap-2 px-5 py-4 border-t border-[#e2ece3]">
          <button type="button" class="rounded-lg border border-[#e2ece3] bg-white px-3.5 py-2 text-[0.84rem] font-semibold text-[#3d4a3e] hover:bg-[#f0f7f1] cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#2c6e33]" @click="closeDisable">
            Huỷ
          </button>
          <button type="button" :disabled="disableDialog.busy"
                  class="inline-flex items-center gap-2 rounded-lg bg-[#d12420] hover:bg-[#b31d19] px-4 py-2 text-[0.84rem] font-bold text-white border-0 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2"
                  @click="submitDisable">
            <i v-if="disableDialog.busy" class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>
            Xác nhận tắt
          </button>
        </div>
      </div>
    </div>

    <!-- ── Modal: mã dự phòng ────────────────────────────────────────── -->
    <div v-if="recoveryDialog.open" class="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto" @click.self="closeRecovery">
      <div class="w-full max-w-md rounded-xl bg-white shadow-xl mt-16" role="dialog" aria-modal="true" aria-labelledby="recovery-title">
        <div class="flex items-center gap-3 px-5 py-4 border-b border-[#e2ece3]">
          <i class="fa-solid fa-life-ring text-[#2c6e33]" aria-hidden="true"></i>
          <h3 id="recovery-title" class="text-[0.95rem] font-extrabold text-[#122815] m-0 flex-1">
            {{ recoveryDialog.mode === 'create' ? 'Tạo mã dự phòng' : 'Tắt mã dự phòng' }}
          </h3>
          <button type="button" aria-label="Đóng"
                  class="w-8 h-8 rounded-lg border-0 bg-transparent text-[#667768] hover:bg-[#f0f7f1] cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#2c6e33]"
                  @click="closeRecovery">
            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
          </button>
        </div>
        <div class="px-5 py-4 flex flex-col gap-3.5">
          <div v-if="recoveryDialog.error" class="flex items-start gap-2 bg-[#ffebe9] border border-[#ffc1ba] text-[#d12420] px-3.5 py-2.5 rounded-lg text-[0.84rem]" role="alert">
            <i class="fa-solid fa-triangle-exclamation shrink-0 mt-0.5" aria-hidden="true"></i>
            <span>{{ recoveryDialog.error }}</span>
          </div>
          <p class="text-[0.83rem] text-[#667768] m-0">
            <template v-if="recoveryDialog.mode === 'create'">
              Hệ thống sinh 10 mã mới, mỗi mã dùng một lần.
              <strong v-if="mfa?.recoveryCodesEnabled">Toàn bộ mã cũ sẽ hết hiệu lực ngay.</strong>
            </template>
            <template v-else>
              Sau khi tắt, nếu mất thiết bị xác thực bạn sẽ cần quản trị viên cấp cao mở lại tài khoản.
            </template>
          </p>
          <div>
            <label for="recovery-pw" class="block text-[0.82rem] font-semibold text-[#3d4a3e] mb-1.5">Mật khẩu hiện tại</label>
            <input id="recovery-pw" v-model="recoveryDialog.currentPassword" type="password" autocomplete="current-password"
                   class="w-full rounded-lg border border-[#e2ece3] px-3.5 py-2.5 text-[0.88rem] text-[#122815] focus:outline-none focus:ring-2 focus:ring-[#2c6e33] focus:border-[#2c6e33]"
                   @keyup.enter="submitRecovery" />
          </div>
        </div>
        <div class="flex items-center justify-end gap-2 px-5 py-4 border-t border-[#e2ece3]">
          <button type="button" class="rounded-lg border border-[#e2ece3] bg-white px-3.5 py-2 text-[0.84rem] font-semibold text-[#3d4a3e] hover:bg-[#f0f7f1] cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#2c6e33]" @click="closeRecovery">
            Huỷ
          </button>
          <button type="button" :disabled="recoveryDialog.busy"
                  class="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[0.84rem] font-bold text-white border-0 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2"
                  :class="recoveryDialog.mode === 'create' ? 'bg-[#1e4620] hover:bg-[#2c6e33] focus:ring-[#2c6e33]' : 'bg-[#d12420] hover:bg-[#b31d19] focus:ring-red-400'"
                  @click="submitRecovery">
            <i v-if="recoveryDialog.busy" class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>
            {{ recoveryDialog.mode === 'create' ? 'Tạo mã' : 'Xác nhận tắt' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
