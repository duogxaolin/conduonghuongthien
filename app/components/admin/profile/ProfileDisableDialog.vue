<script setup lang="ts">
/**
 * Hộp thoại "Tắt <yếu tố>" của /admin/profile — chỉ trình bày: hỏi mật khẩu hiện tại.
 * Trạng thái và request nằm ở `useMfaDisableDialog` (app/composables/useProfileMfaFactors.ts);
 * trang mở/đóng hộp (`v-if`) và bắt Escape.
 */
import { isDeliberateEnter } from '~/utils/admin-modal'
import { MFA_FACTOR_META } from '~/utils/profile-mfa'
import type { FactorType } from '~/types/admin-profile'

defineProps<{ factorType: FactorType, busy: boolean, error: string }>()
const currentPassword = defineModel<string>('currentPassword', { required: true })
const emit = defineEmits<{ close: [], submit: [] }>()

/** Enter trong ô = "Xác nhận tắt" — chỉ lần nhấn có chủ đích (không lặp phím, không phải
 *  Enter chốt chữ của bộ gõ); xem ProfileEnrollDialog.vue. */
function submitOnEnter(event: KeyboardEvent) {
  if (!isDeliberateEnter(event)) return
  event.preventDefault()
  emit('submit')
}
</script>

<template>
  <div class="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto" @click.self="emit('close')">
    <div class="w-full max-w-md rounded-xl bg-white shadow-xl mt-16" role="dialog" aria-modal="true" aria-labelledby="disable-title">
      <div class="flex items-center gap-3 px-5 py-4 border-b border-line">
        <i class="fa-solid fa-shield-halved text-danger" aria-hidden="true"></i>
        <h3 id="disable-title" class="text-[0.95rem] font-extrabold text-brand-950 m-0 flex-1">
          Tắt {{ MFA_FACTOR_META[factorType].label }}
        </h3>
        <button type="button" aria-label="Đóng"
                class="w-8 h-8 rounded-lg border-0 bg-transparent text-ink-muted hover:bg-surface-tint cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-700"
                @click="emit('close')">
          <i class="fa-solid fa-xmark" aria-hidden="true"></i>
        </button>
      </div>
      <div class="px-5 py-4 flex flex-col gap-3.5">
        <div v-if="error" class="flex items-start gap-2 bg-danger-bg border border-[#ffc1ba] text-danger px-3.5 py-2.5 rounded-lg text-[0.84rem]" role="alert">
          <i class="fa-solid fa-triangle-exclamation shrink-0 mt-0.5" aria-hidden="true"></i>
          <span>{{ error }}</span>
        </div>
        <p class="text-[0.83rem] text-ink-muted m-0">
          Tắt yếu tố này thì tài khoản của bạn sẽ giảm một lớp bảo vệ. Nhập mật khẩu hiện tại để xác nhận.
        </p>
        <div>
          <label for="disable-pw" class="block text-[0.82rem] font-semibold text-[#3d4a3e] mb-1.5">Mật khẩu hiện tại</label>
          <input id="disable-pw" v-model="currentPassword" type="password" autocomplete="current-password"
                 class="w-full rounded-lg border border-line px-3.5 py-2.5 text-[0.88rem] text-brand-950 focus:outline-none focus:ring-2 focus:ring-brand-700 focus:border-brand-700"
                 @keydown.enter="submitOnEnter($event)" />
        </div>
      </div>
      <div class="flex items-center justify-end gap-2 px-5 py-4 border-t border-line">
        <button type="button" class="rounded-lg border border-line bg-white px-3.5 py-2 text-[0.84rem] font-semibold text-[#3d4a3e] hover:bg-surface-tint cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-700" @click="emit('close')">
          Huỷ
        </button>
        <button type="button" :disabled="busy"
                class="inline-flex items-center gap-2 rounded-lg bg-danger hover:bg-[#b31d19] px-4 py-2 text-[0.84rem] font-bold text-white border-0 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2"
                @click="emit('submit')">
          <i v-if="busy" class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>
          Xác nhận tắt
        </button>
      </div>
    </div>
  </div>
</template>
