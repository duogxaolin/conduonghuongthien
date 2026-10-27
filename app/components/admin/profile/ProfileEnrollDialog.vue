<script setup lang="ts">
/**
 * Hộp thoại "Bật <yếu tố>" của /admin/profile — chỉ trình bày. Bước 1: mật khẩu hiện tại
 * (và đặt mật khẩu cấp 2); bước 2: mã xác thực, hoặc nhập lại mật khẩu cấp 2. Trạng thái
 * và request nằm ở `useMfaEnrollDialog` (app/composables/useProfileMfaFactors.ts); trang
 * mở/đóng hộp (`v-if`) và bắt Escape.
 */
import { isDeliberateEnter } from '~/utils/admin-modal'
import { MFA_FACTOR_META } from '~/utils/profile-mfa'
import type { FactorType } from '~/types/admin-profile'

defineProps<{
  factorType: FactorType
  stage: 'password' | 'confirm'
  totpSecret: string
  /** Link otpauth:// cho ứng dụng trên cùng thiết bị. */
  otpauthUri: string
  sentTo: string
  /** Email của tài khoản — hiện khi máy chủ không trả `sentTo`. */
  email: string | null | undefined
  busy: boolean
  error: string
}>()
const currentPassword = defineModel<string>('currentPassword', { required: true })
const secondPassword = defineModel<string>('secondPassword', { required: true })
const secondPasswordConfirm = defineModel<string>('secondPasswordConfirm', { required: true })
const code = defineModel<string>('code', { required: true })
const emit = defineEmits<{ close: [], enroll: [], confirm: [], resend: [] }>()

/** Enter trong ô nhập của hộp thoại = gửi bước hiện tại. Ở `keydown`, KHÔNG `keyup`:
 *  hộp mở bằng Enter trên nút "Bật"/"Tắt" đưa focus vào ô đầu tiên trước khi phím được
 *  thả — `@keyup.enter` từng gửi biểu mẫu trống và báo "Vui lòng nhập mật khẩu hiện
 *  tại" khi người dùng chưa gõ gì. Bỏ qua lúc đang gõ dấu (IME chốt chữ bằng Enter). */
function submitOnEnter(event: KeyboardEvent, step: 'enroll' | 'confirm') {
  // Giữ Enter trên nút mở: hệ điều hành lặp phím vào ô vừa nhận focus — chỉ nhận lần
  // nhấn có chủ đích (không lặp, không phải Enter chốt chữ của bộ gõ).
  if (!isDeliberateEnter(event)) return
  event.preventDefault()
  if (step === 'enroll') emit('enroll')
  else emit('confirm')
}
</script>

<template>
  <div class="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto" @click.self="emit('close')">
    <div class="w-full max-w-lg rounded-xl bg-white shadow-xl mt-10" role="dialog" aria-modal="true" aria-labelledby="enroll-title">
      <div class="flex items-center gap-3 px-5 py-4 border-b border-line">
        <i :class="MFA_FACTOR_META[factorType].icon" class="text-brand-700" aria-hidden="true"></i>
        <h3 id="enroll-title" class="text-[0.95rem] font-extrabold text-brand-950 m-0 flex-1">
          Bật {{ MFA_FACTOR_META[factorType].label }}
        </h3>
        <button type="button" aria-label="Đóng"
                class="w-8 h-8 rounded-lg border-0 bg-transparent text-ink-muted hover:bg-surface-tint cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-700"
                @click="emit('close')">
          <i class="fa-solid fa-xmark" aria-hidden="true"></i>
        </button>
      </div>

      <div class="px-5 py-4 flex flex-col gap-3.5">
        <div v-if="error" class="flex items-start gap-2 bg-[#ffebe9] border border-[#ffc1ba] text-danger px-3.5 py-2.5 rounded-lg text-[0.84rem]" role="alert">
          <i class="fa-solid fa-triangle-exclamation shrink-0 mt-0.5" aria-hidden="true"></i>
          <span>{{ error }}</span>
        </div>

        <!-- Bước 1: xác nhận mật khẩu hiện tại -->
        <template v-if="stage === 'password'">
          <p class="text-[0.83rem] text-ink-muted m-0">
            {{ MFA_FACTOR_META[factorType].desc }}
            Nhập mật khẩu hiện tại để xác nhận đây đúng là bạn.
          </p>
          <div>
            <label for="enroll-pw" class="block text-[0.82rem] font-semibold text-[#3d4a3e] mb-1.5">Mật khẩu hiện tại</label>
            <input id="enroll-pw" v-model="currentPassword" type="password" autocomplete="current-password"
                   class="w-full rounded-lg border border-line px-3.5 py-2.5 text-[0.88rem] text-brand-950 focus:outline-none focus:ring-2 focus:ring-brand-700 focus:border-brand-700"
                   @keydown.enter="submitOnEnter($event, 'enroll')" />
          </div>
          <template v-if="factorType === 'second_password'">
            <div>
              <label for="enroll-sp" class="block text-[0.82rem] font-semibold text-[#3d4a3e] mb-1.5">Mật khẩu cấp 2</label>
              <input id="enroll-sp" v-model="secondPassword" type="password" autocomplete="new-password"
                     class="w-full rounded-lg border border-line px-3.5 py-2.5 text-[0.88rem] text-brand-950 focus:outline-none focus:ring-2 focus:ring-brand-700 focus:border-brand-700" />
              <p class="text-[0.76rem] text-[#8ea98f] mt-1.5 mb-0">
                Cùng yêu cầu độ mạnh như mật khẩu đăng nhập, và phải khác mật khẩu đăng nhập.
              </p>
            </div>
            <div>
              <label for="enroll-sp2" class="block text-[0.82rem] font-semibold text-[#3d4a3e] mb-1.5">Nhập lại mật khẩu cấp 2</label>
              <input id="enroll-sp2" v-model="secondPasswordConfirm" type="password" autocomplete="new-password"
                     class="w-full rounded-lg border border-line px-3.5 py-2.5 text-[0.88rem] text-brand-950 focus:outline-none focus:ring-2 focus:ring-brand-700 focus:border-brand-700"
                     @keydown.enter="submitOnEnter($event, 'enroll')" />
            </div>
          </template>
        </template>

        <!-- Bước 2: xác nhận -->
        <template v-else>
          <!-- TOTP: hiện bí mật để nhập tay, không sinh QR qua bên thứ ba (QR qua API
               công khai của Google Charts rò URI chứa bí mật ra bên thứ ba) -->
          <template v-if="factorType === 'totp'">
            <p class="text-[0.83rem] text-ink-muted m-0">
              Mở Google Authenticator (hoặc app tương tự) → <strong>Thêm tài khoản</strong> → <strong>Nhập khoá thủ công</strong>,
              rồi dán chuỗi dưới đây.
            </p>
            <div class="flex items-start gap-2 bg-[#fdf6e7] border border-[#f0dcae] text-[#8a6412] px-3.5 py-2.5 rounded-lg text-[0.82rem]" role="alert">
              <i class="fa-solid fa-triangle-exclamation shrink-0 mt-0.5" aria-hidden="true"></i>
              <span>Chuỗi này chỉ hiện <strong>một lần</strong>. Đóng cửa sổ mà chưa thêm vào app thì phải bật lại từ đầu.</span>
            </div>
            <div class="rounded-lg border border-line bg-[#fafcfa] px-3.5 py-3">
              <div class="text-[0.74rem] font-bold text-ink-muted uppercase tracking-wide mb-1">Khoá bí mật</div>
              <code class="block font-mono text-[0.95rem] font-bold text-brand-950 break-all leading-relaxed">{{ totpSecret }}</code>
              <a v-if="otpauthUri" :href="otpauthUri"
                 class="inline-flex items-center gap-2 mt-2.5 text-[0.8rem] font-bold text-brand-700 no-underline hover:underline focus:outline-none focus:ring-2 focus:ring-brand-700 rounded">
                <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>
                Mở bằng app trên thiết bị này
              </a>
            </div>
          </template>

          <!-- Email OTP -->
          <template v-else-if="factorType === 'email_otp'">
            <p class="text-[0.83rem] text-ink-muted m-0" role="status">
              Đã gửi mã 6 số tới <strong>{{ sentTo || email }}</strong>. Mã sống 10 phút.
            </p>
            <button type="button" :disabled="busy"
                    class="self-start inline-flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-[0.82rem] font-semibold text-brand-700 hover:bg-surface-tint cursor-pointer disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-brand-700"
                    @click="emit('resend')">
              <i class="fa-solid fa-paper-plane" aria-hidden="true"></i>
              Gửi lại mã
            </button>
          </template>

          <p v-else class="text-[0.83rem] text-ink-muted m-0">
            Nhập lại mật khẩu cấp 2 một lần nữa để chắc chắn bạn đã ghi nhớ đúng.
          </p>

          <div v-if="factorType !== 'second_password'">
            <label for="enroll-code" class="block text-[0.82rem] font-semibold text-[#3d4a3e] mb-1.5">Mã xác thực</label>
            <input id="enroll-code" v-model="code" type="text" inputmode="numeric"
                   autocomplete="one-time-code" maxlength="8"
                   class="w-full rounded-lg border border-line px-3.5 py-2.5 text-[1rem] font-mono tracking-[0.3em] text-brand-950 focus:outline-none focus:ring-2 focus:ring-brand-700 focus:border-brand-700"
                   @keydown.enter="submitOnEnter($event, 'confirm')" />
          </div>
          <div v-else>
            <label for="enroll-sp-confirm" class="block text-[0.82rem] font-semibold text-[#3d4a3e] mb-1.5">Mật khẩu cấp 2</label>
            <input id="enroll-sp-confirm" v-model="secondPassword" type="password" autocomplete="off"
                   class="w-full rounded-lg border border-line px-3.5 py-2.5 text-[0.88rem] text-brand-950 focus:outline-none focus:ring-2 focus:ring-brand-700 focus:border-brand-700"
                   @keydown.enter="submitOnEnter($event, 'confirm')" />
          </div>

          <p class="text-[0.78rem] text-[#8ea98f] m-0">
            <i class="fa-solid fa-circle-info mr-1" aria-hidden="true"></i>
            Bật xong, các phiên đăng nhập khác sẽ bị thu hồi — phiên hiện tại vẫn giữ.
          </p>
        </template>
      </div>

      <div class="flex items-center justify-end gap-2 px-5 py-4 border-t border-line">
        <button type="button" class="rounded-lg border border-line bg-white px-3.5 py-2 text-[0.84rem] font-semibold text-[#3d4a3e] hover:bg-surface-tint cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-700" @click="emit('close')">
          Huỷ
        </button>
        <button type="button" :disabled="busy"
                class="inline-flex items-center gap-2 rounded-lg bg-brand-900 hover:bg-brand-700 px-4 py-2 text-[0.84rem] font-bold text-white border-0 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-brand-700 focus:ring-offset-2"
                @click="stage === 'password' ? emit('enroll') : emit('confirm')">
          <i v-if="busy" class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>
          {{ stage === 'password' ? 'Tiếp tục' : 'Xác nhận bật' }}
        </button>
      </div>
    </div>
  </div>
</template>
