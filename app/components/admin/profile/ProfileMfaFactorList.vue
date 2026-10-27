<script setup lang="ts">
/**
 * Ba thẻ yếu tố thứ hai của /admin/profile (ứng dụng xác thực, OTP email, mật khẩu cấp 2)
 * — chỉ trình bày. Trang giữ trạng thái (`mfa`), nhánh tải/lỗi/thử lại, và mở hộp thoại
 * bật/tắt khi nhận `enroll`/`disable`.
 */
import { formatDateTimeVN } from '~/utils/formatDate'
import { MFA_FACTOR_META, canEnrollMfaFactor } from '~/utils/profile-mfa'
import type { FactorType, MfaFactor } from '~/types/admin-profile'

const props = defineProps<{ factors: MfaFactor[], email: string | null, smtpReady: boolean }>()
const emit = defineEmits<{ enroll: [type: FactorType], disable: [type: FactorType] }>()

const canEnroll = (type: FactorType) => canEnrollMfaFactor(type, props)
</script>

<template>
  <div class="flex flex-col gap-3">
    <div
      v-for="f in factors"
      :key="f.factorType"
      class="rounded-xl border p-4 flex items-start gap-4 flex-wrap"
      :class="f.state === 'active' ? 'border-[#cce5cd] bg-[#fafcfa]' : 'border-line bg-white'"
    >
      <div class="w-10 h-10 rounded-xl bg-surface-tint border border-line flex items-center justify-center shrink-0">
        <i :class="MFA_FACTOR_META[f.factorType].icon" class="text-brand-700" aria-hidden="true"></i>
      </div>
      <div class="flex-1 min-w-[220px]">
        <div class="flex items-center gap-2 flex-wrap">
          <strong class="text-[0.9rem] text-brand-950">{{ MFA_FACTOR_META[f.factorType].label }}</strong>
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
                class="inline-flex items-center gap-1 text-[0.7rem] font-bold px-2 py-0.5 rounded-full border bg-[#ffebe9] border-[#ffc1ba] text-danger">
            <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
            Không dùng được
          </span>
        </div>
        <p class="text-[0.8rem] text-ink-muted mt-1 mb-0">{{ MFA_FACTOR_META[f.factorType].desc }}</p>
        <p v-if="f.state === 'active' && !f.usable" class="text-[0.78rem] text-danger mt-1.5 mb-0">
          Bí mật lưu trữ không giải mã được (thường do khóa JWT_SECRET đã bị đổi). Hãy tắt rồi bật lại yếu tố này.
        </p>
        <p v-if="f.factorType === 'email_otp' && !canEnroll('email_otp')" class="text-[0.78rem] text-[#8a6412] mt-1.5 mb-0">
          <i class="fa-solid fa-circle-info mr-1" aria-hidden="true"></i>
          <template v-if="!email">Tài khoản chưa có email — cần bổ sung email trước.</template>
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
          class="inline-flex items-center gap-2 rounded-lg bg-brand-900 hover:bg-brand-700 px-3.5 py-2 text-[0.84rem] font-bold text-white border-0 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-brand-700 focus:ring-offset-2"
          @click="emit('enroll', f.factorType)"
        >
          <i class="fa-solid fa-plus" aria-hidden="true"></i>
          {{ f.state === 'pending' ? 'Tiếp tục bật' : 'Bật' }}
        </button>
        <button
          v-else
          type="button"
          class="inline-flex items-center gap-2 rounded-lg border border-line bg-white px-3.5 py-2 text-[0.84rem] font-semibold text-danger hover:bg-red-50 cursor-pointer focus:outline-none focus:ring-2 focus:ring-red-400"
          @click="emit('disable', f.factorType)"
        >
          <i class="fa-solid fa-power-off" aria-hidden="true"></i>
          Tắt
        </button>
      </div>
    </div>
  </div>
</template>
