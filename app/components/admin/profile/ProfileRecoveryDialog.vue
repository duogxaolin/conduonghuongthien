<script setup lang="ts">
/**
 * Hộp thoại "Tạo mã dự phòng" / "Tắt mã dự phòng" của /admin/profile — chỉ trình bày: hỏi
 * mật khẩu hiện tại. Trạng thái, request và lô mã nằm ở `useProfileRecoveryCodes`
 * (app/composables); trang mở/đóng hộp (`v-if`) và bắt Escape.
 */
import { isDeliberateEnter } from '~/utils/admin-modal'

defineProps<{
  mode: 'create' | 'delete'
  /** Đang có lô mã: tạo lô mới thì lô cũ hết hiệu lực ngay. */
  replacesCodes: boolean
  busy: boolean
  error: string
}>()
const currentPassword = defineModel<string>('currentPassword', { required: true })
const emit = defineEmits<{ close: [], submit: [] }>()

/** Enter trong ô = gửi — chỉ lần nhấn có chủ đích (không lặp phím, không phải Enter chốt
 *  chữ của bộ gõ); xem ProfileEnrollDialog.vue. */
function submitOnEnter(event: KeyboardEvent) {
  if (!isDeliberateEnter(event)) return
  event.preventDefault()
  emit('submit')
}
</script>

<template>
  <div class="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto" @click.self="emit('close')">
    <div class="w-full max-w-md rounded-xl bg-white shadow-xl mt-16" role="dialog" aria-modal="true" aria-labelledby="recovery-title">
      <div class="flex items-center gap-3 px-5 py-4 border-b border-line">
        <i class="fa-solid fa-life-ring text-brand-700" aria-hidden="true"></i>
        <h3 id="recovery-title" class="text-[0.95rem] font-extrabold text-brand-950 m-0 flex-1">
          {{ mode === 'create' ? 'Tạo mã dự phòng' : 'Tắt mã dự phòng' }}
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
        <p class="text-[0.83rem] text-ink-muted m-0">
          <template v-if="mode === 'create'">
            Hệ thống sinh 10 mã mới, mỗi mã dùng một lần.
            <strong v-if="replacesCodes">Toàn bộ mã cũ sẽ hết hiệu lực ngay.</strong>
          </template>
          <template v-else>
            Sau khi tắt, nếu mất thiết bị xác thực bạn sẽ cần quản trị viên cấp cao mở lại tài khoản.
          </template>
        </p>
        <div>
          <label for="recovery-pw" class="block text-[0.82rem] font-semibold text-[#3d4a3e] mb-1.5">Mật khẩu hiện tại</label>
          <input id="recovery-pw" v-model="currentPassword" type="password" autocomplete="current-password"
                 class="w-full rounded-lg border border-line px-3.5 py-2.5 text-[0.88rem] text-brand-950 focus:outline-none focus:ring-2 focus:ring-brand-700 focus:border-brand-700"
                 @keydown.enter="submitOnEnter($event)" />
        </div>
      </div>
      <div class="flex items-center justify-end gap-2 px-5 py-4 border-t border-line">
        <button type="button" class="rounded-lg border border-line bg-white px-3.5 py-2 text-[0.84rem] font-semibold text-[#3d4a3e] hover:bg-surface-tint cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-700" @click="emit('close')">
          Huỷ
        </button>
        <button type="button" :disabled="busy"
                class="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[0.84rem] font-bold text-white border-0 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2"
                :class="mode === 'create' ? 'bg-brand-900 hover:bg-[#2c6e33] focus:ring-brand-700' : 'bg-danger hover:bg-[#b31d19] focus:ring-red-400'"
                @click="emit('submit')">
          <i v-if="busy" class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>
          {{ mode === 'create' ? 'Tạo mã' : 'Xác nhận tắt' }}
        </button>
      </div>
    </div>
  </div>
</template>
