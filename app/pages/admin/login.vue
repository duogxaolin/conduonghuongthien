<script setup lang="ts">
import type { MfaMethod } from '~/composables/useAdminAuth'

definePageMeta({ layout: false })

const { login, verifyMfa } = useAdminAuth()

const username = ref('')
const password = ref('')
const errorMsg = ref('')
const loading = ref(false)

// Bước 2: chỉ hiện khi tài khoản đã bật ít nhất một yếu tố thứ hai.
const step = ref<'password' | 'challenge'>('password')
const methods = ref<MfaMethod[]>([])
const recoveryAvailable = ref(false)
const selectedMethod = ref<MfaMethod>('totp')
const code = ref('')
const sendingCode = ref(false)
const infoMsg = ref('')
const codeInput = ref<HTMLInputElement | null>(null)

const METHOD_META: Record<MfaMethod, { label: string; icon: string; hint: string; inputLabel: string; type: string; autocomplete: string }> = {
  totp: {
    label: 'Ứng dụng xác thực',
    icon: 'fa-solid fa-mobile-screen-button',
    hint: 'Mở Google Authenticator (hoặc ứng dụng tương đương) và nhập mã 6 số đang hiển thị.',
    inputLabel: 'Mã 6 số từ ứng dụng',
    type: 'text',
    autocomplete: 'one-time-code',
  },
  email_otp: {
    label: 'Mã qua email',
    icon: 'fa-solid fa-envelope',
    hint: 'Bấm "Gửi mã" rồi nhập mã 6 số trong email. Mã có hiệu lực 10 phút.',
    inputLabel: 'Mã 6 số trong email',
    type: 'text',
    autocomplete: 'one-time-code',
  },
  second_password: {
    label: 'Mật khẩu cấp 2',
    icon: 'fa-solid fa-key',
    hint: 'Nhập mật khẩu cấp 2 mà bạn đã đặt riêng cho bước xác thực này.',
    inputLabel: 'Mật khẩu cấp 2',
    type: 'password',
    autocomplete: 'off',
  },
  recovery_code: {
    label: 'Mã dự phòng',
    icon: 'fa-solid fa-life-ring',
    hint: 'Nhập một mã dự phòng đã lưu. Mỗi mã chỉ dùng được một lần.',
    inputLabel: 'Mã dự phòng (VD: ABCDE-12345)',
    type: 'text',
    autocomplete: 'off',
  },
}

const currentMeta = computed(() => METHOD_META[selectedMethod.value])

/** Danh sách nút chọn: các yếu tố đã bật, cộng mã dự phòng nếu còn mã chưa dùng. */
const methodChoices = computed<MfaMethod[]>(() => (
  recoveryAvailable.value ? [...methods.value, 'recovery_code' as MfaMethod] : methods.value
))

function selectMethod(method: MfaMethod) {
  selectedMethod.value = method
  code.value = ''
  errorMsg.value = ''
  infoMsg.value = ''
  nextTick(() => codeInput.value?.focus())
}

const handleLogin = async () => {
  if (!username.value || !password.value) {
    errorMsg.value = 'Vui lòng nhập tài khoản và mật khẩu.'
    return
  }
  errorMsg.value = ''
  loading.value = true
  try {
    const res = await login(username.value, password.value)
    if (res.ok && res.mfaRequired) {
      methods.value = res.methods ?? []
      recoveryAvailable.value = res.recoveryCodesAvailable === true
      selectedMethod.value = methods.value[0] ?? 'totp'
      step.value = 'challenge'
      // Mật khẩu đã dùng xong: không giữ lại trong bộ nhớ trang.
      password.value = ''
      nextTick(() => codeInput.value?.focus())
      return
    }
    if (res.ok) navigateTo('/admin')
  } catch (err: any) {
    errorMsg.value = err?.data?.statusMessage || err?.message || 'Đăng nhập thất bại'
  } finally {
    loading.value = false
  }
}

const handleVerify = async () => {
  if (!code.value.trim()) {
    errorMsg.value = 'Vui lòng nhập mã xác thực.'
    return
  }
  errorMsg.value = ''
  infoMsg.value = ''
  loading.value = true
  try {
    const res = await verifyMfa(selectedMethod.value, code.value.trim())
    if (res.ok) navigateTo('/admin')
  } catch (err: any) {
    const status = err?.response?.status ?? err?.statusCode
    errorMsg.value = err?.data?.statusMessage || err?.message || 'Xác thực thất bại'
    code.value = ''
    // 401 = hết vé thử thách; 429 = đã bị chặn tạm thời. Cả hai đều phải quay lại
    // bước mật khẩu, vì vé trong cookie đã bị xoá phía server.
    if (status === 401 || status === 429) {
      step.value = 'password'
      methods.value = []
      recoveryAvailable.value = false
    }
  } finally {
    loading.value = false
  }
}

const handleSendCode = async () => {
  sendingCode.value = true
  errorMsg.value = ''
  infoMsg.value = ''
  try {
    const res = await $fetch<{ ok: boolean; sentTo?: string }>('/api/admin/auth/mfa/send-code', { method: 'POST' })
    if (res.ok) infoMsg.value = `Đã gửi mã tới ${res.sentTo || 'email của bạn'}. Mã có hiệu lực 10 phút.`
    nextTick(() => codeInput.value?.focus())
  } catch (err: any) {
    errorMsg.value = err?.data?.statusMessage || 'Không gửi được mã. Vui lòng thử cách khác.'
  } finally {
    sendingCode.value = false
  }
}

function backToPassword() {
  step.value = 'password'
  code.value = ''
  errorMsg.value = ''
  infoMsg.value = ''
  methods.value = []
  recoveryAvailable.value = false
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0d1e10] to-[#1e4620] p-5 font-[Inter,system-ui,sans-serif]">
    <div class="w-full max-w-[420px] bg-white rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.3)] overflow-hidden">
      <div class="px-8 pt-8 pb-6 text-center bg-[#f8faf8] border-b border-[#eef2ee]">
        <div class="w-14 h-14 bg-[#e4f2e5] text-[#2c6e33] text-3xl rounded-full flex items-center justify-center mx-auto mb-4">
          <i class="fa-solid fa-leaf"></i>
        </div>
        <h2 class="text-[1.15rem] font-extrabold text-[#122815] m-0 mb-1.5 tracking-[0.5px]">CON ĐƯỜNG HƯỚNG THIỆN</h2>
        <p class="text-[0.82rem] text-[#667768] m-0">Hệ thống Quản trị Nội dung (Admin Panel)</p>
      </div>

      <form v-if="step === 'password'" @submit.prevent="handleLogin" class="px-8 py-8">
        <div v-if="errorMsg" class="flex items-center gap-2 bg-[#ffebe9] border border-[#ffc1ba] text-[#d12420] px-3.5 py-2.5 rounded-lg text-[0.84rem] mb-5" role="alert">
          <i class="fa-solid fa-triangle-exclamation shrink-0" aria-hidden="true"></i>
          {{ errorMsg }}
        </div>

        <div class="mb-5">
          <label class="block text-[0.82rem] font-bold text-[#2c3e2e] mb-2">Tài khoản</label>
          <input
            type="text"
            v-model="username"
            placeholder="Nhập tên đăng nhập"
            required
            autocomplete="username"
            class="w-full px-3.5 py-3 border border-[#c8d6c9] rounded-lg text-[0.92rem] outline-none transition-[border-color,box-shadow] duration-200 focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border"
          />
        </div>

        <div class="mb-5">
          <label class="block text-[0.82rem] font-bold text-[#2c3e2e] mb-2">Mật khẩu</label>
          <input
            type="password"
            v-model="password"
            placeholder="Nhập mật khẩu"
            required
            autocomplete="current-password"
            class="w-full px-3.5 py-3 border border-[#c8d6c9] rounded-lg text-[0.92rem] outline-none transition-[border-color,box-shadow] duration-200 focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border"
          />
        </div>

        <button
          type="submit"
          :disabled="loading"
          class="w-full py-3.5 bg-[#1e4620] hover:bg-[#2c6e33] text-white border-0 rounded-lg text-[0.95rem] font-bold cursor-pointer transition-colors mt-2 disabled:opacity-70 disabled:cursor-not-allowed"
        >
          {{ loading ? 'Đang xác thực...' : 'Đăng nhập hệ thống' }}
        </button>
      </form>

      <!-- ── Bước 2: xác thực hai bước ─────────────────────────────────── -->
      <form v-else @submit.prevent="handleVerify" class="px-8 py-8">
        <div class="flex items-start gap-3 mb-5">
          <div class="w-10 h-10 rounded-full bg-[#e4f2e5] text-[#2c6e33] flex items-center justify-center shrink-0">
            <i class="fa-solid fa-shield-halved" aria-hidden="true"></i>
          </div>
          <div>
            <h3 class="text-[0.95rem] font-extrabold text-[#122815] m-0">Xác thực hai bước</h3>
            <p class="text-[0.8rem] text-[#667768] m-0 mt-0.5">Mật khẩu đã đúng. Còn một bước nữa để vào hệ thống.</p>
          </div>
        </div>

        <div v-if="errorMsg" class="flex items-start gap-2 bg-[#ffebe9] border border-[#ffc1ba] text-[#d12420] px-3.5 py-2.5 rounded-lg text-[0.84rem] mb-4" role="alert">
          <i class="fa-solid fa-triangle-exclamation shrink-0 mt-0.5" aria-hidden="true"></i>
          <span>{{ errorMsg }}</span>
        </div>
        <div v-if="infoMsg" class="flex items-start gap-2 bg-[#eef7ee] border border-[#cce5cd] text-[#1e4620] px-3.5 py-2.5 rounded-lg text-[0.84rem] mb-4" role="status">
          <i class="fa-solid fa-circle-check shrink-0 mt-0.5" aria-hidden="true"></i>
          <span>{{ infoMsg }}</span>
        </div>

        <!-- Chọn cách xác thực (chỉ hiện khi có nhiều hơn một cách) -->
        <div v-if="methodChoices.length > 1" class="mb-4">
          <span class="block text-[0.82rem] font-bold text-[#2c3e2e] mb-2">Chọn cách xác thực</span>
          <div class="flex flex-col gap-2">
            <button
              v-for="m in methodChoices"
              :key="m"
              type="button"
              class="flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg border text-left text-[0.85rem] font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[#2c6e33] focus:ring-offset-1"
              :class="selectedMethod === m ? 'bg-[#e4f2e5] border-[#2c6e33] text-[#1e4620]' : 'bg-white border-[#c8d6c9] text-[#334e36] hover:bg-[#f0f7f1]'"
              :aria-pressed="selectedMethod === m"
              @click="selectMethod(m)"
            >
              <i :class="METHOD_META[m].icon" class="w-4 text-center shrink-0" aria-hidden="true"></i>
              <span class="flex-1">{{ METHOD_META[m].label }}</span>
              <!-- Dấu chọn bằng ký hiệu, không chỉ bằng màu -->
              <i v-if="selectedMethod === m" class="fa-solid fa-check text-[#2c6e33]" aria-hidden="true"></i>
            </button>
          </div>
        </div>

        <p class="text-[0.8rem] text-[#667768] mb-4 m-0">{{ currentMeta.hint }}</p>

        <button
          v-if="selectedMethod === 'email_otp'"
          type="button"
          :disabled="sendingCode"
          class="inline-flex items-center gap-2 mb-4 px-3.5 py-2 rounded-lg border border-[#2c6e33] bg-white text-[0.84rem] font-bold text-[#2c6e33] hover:bg-[#f0f7f1] disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[#2c6e33] focus:ring-offset-1"
          @click="handleSendCode"
        >
          <i class="fa-solid" :class="sendingCode ? 'fa-spinner fa-spin' : 'fa-paper-plane'" aria-hidden="true"></i>
          {{ sendingCode ? 'Đang gửi…' : 'Gửi mã tới email' }}
        </button>

        <div class="mb-5">
          <label for="mfa-code" class="block text-[0.82rem] font-bold text-[#2c3e2e] mb-2">{{ currentMeta.inputLabel }}</label>
          <input
            id="mfa-code"
            ref="codeInput"
            v-model="code"
            :type="currentMeta.type"
            :autocomplete="currentMeta.autocomplete"
            :inputmode="selectedMethod === 'totp' || selectedMethod === 'email_otp' ? 'numeric' : 'text'"
            maxlength="32"
            required
            class="w-full px-3.5 py-3 border border-[#c8d6c9] rounded-lg text-[0.92rem] outline-none transition-[border-color,box-shadow] duration-200 focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border tracking-[0.15em] font-semibold"
          />
        </div>

        <button
          type="submit"
          :disabled="loading"
          class="w-full py-3.5 bg-[#1e4620] hover:bg-[#2c6e33] text-white border-0 rounded-lg text-[0.95rem] font-bold cursor-pointer transition-colors disabled:opacity-70 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[#2c6e33] focus:ring-offset-2"
        >
          {{ loading ? 'Đang xác thực...' : 'Xác nhận & Đăng nhập' }}
        </button>

        <button
          type="button"
          class="w-full mt-3 py-2 bg-transparent border-0 text-[0.82rem] font-semibold text-[#667768] hover:text-[#2c6e33] cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#2c6e33] rounded-lg"
          @click="backToPassword"
        >
          <i class="fa-solid fa-arrow-left mr-1.5" aria-hidden="true"></i>
          Quay lại đăng nhập
        </button>
      </form>

      <div class="px-8 py-4 bg-[#f8faf8] border-t border-[#eef2ee] text-center text-[0.75rem] text-[#88998a]">
        Cổng thông tin Hỗ trợ Tái hòa nhập Cộng đồng — Bộ Công an
      </div>
    </div>
  </div>
</template>
