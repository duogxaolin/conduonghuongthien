<script setup lang="ts">
/**
 * Khối "Đổi mật khẩu" của /admin/profile — chỉ trình bày. Ba ô nhập là `v-model`; trạng
 * thái, kiểm tra và request nằm ở `useProfilePassword` (app/composables). Ô lỗi ở đây là
 * lỗi của biểu mẫu (gửi đi rồi bị từ chối), không phải nhánh lỗi tải trang — nhánh đó
 * (`mfaError` + "Thử lại") ở trang.
 */
defineProps<{ saving: boolean, error: string }>()
const currentPassword = defineModel<string>('currentPassword', { required: true })
const newPassword = defineModel<string>('newPassword', { required: true })
const confirmPassword = defineModel<string>('confirmPassword', { required: true })
const emit = defineEmits<{ submit: [] }>()
</script>

<template>
  <section class="rounded-xl border border-line bg-white p-5">
    <div class="flex items-center gap-3 mb-4">
      <span class="w-1 h-5 rounded-full bg-brand-700" aria-hidden="true"></span>
      <h2 class="text-[1rem] font-extrabold text-brand-950 m-0">Đổi mật khẩu</h2>
    </div>
    <p class="text-[0.82rem] text-ink-muted mt-0 mb-4">
      Tối thiểu 12 ký tự, có đủ 3 trong 4 nhóm (chữ thường, chữ hoa, số, ký tự đặc biệt) và không chứa tên đăng nhập.
      Sau khi đổi, các phiên đăng nhập khác sẽ bị thu hồi.
    </p>

    <div v-if="error" class="flex items-start gap-2 bg-[#ffebe9] border border-[#ffc1ba] text-danger px-3.5 py-2.5 rounded-lg text-[0.84rem] mb-4" role="alert">
      <i class="fa-solid fa-triangle-exclamation shrink-0 mt-0.5" aria-hidden="true"></i>
      <span>{{ error }}</span>
    </div>

    <form class="grid grid-cols-1 md:grid-cols-3 gap-3" @submit.prevent="emit('submit')">
      <div>
        <label for="pw-current" class="block text-[0.8rem] font-bold text-[#2c3e2e] mb-1.5">Mật khẩu hiện tại</label>
        <input id="pw-current" v-model="currentPassword" type="password" autocomplete="current-password"
               class="w-full px-3 py-2.5 rounded-lg border border-line-strong text-[0.9rem] outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15" />
      </div>
      <div>
        <label for="pw-next" class="block text-[0.8rem] font-bold text-[#2c3e2e] mb-1.5">Mật khẩu mới</label>
        <input id="pw-next" v-model="newPassword" type="password" autocomplete="new-password"
               class="w-full px-3 py-2.5 rounded-lg border border-line-strong text-[0.9rem] outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15" />
      </div>
      <div>
        <label for="pw-confirm" class="block text-[0.8rem] font-bold text-[#2c3e2e] mb-1.5">Nhập lại mật khẩu mới</label>
        <input id="pw-confirm" v-model="confirmPassword" type="password" autocomplete="new-password"
               class="w-full px-3 py-2.5 rounded-lg border border-line-strong text-[0.9rem] outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15" />
      </div>
      <div class="md:col-span-3">
        <button type="submit" :disabled="saving"
                class="inline-flex items-center gap-2 rounded-lg bg-brand-900 hover:bg-brand-700 px-4 py-2.5 text-sm font-bold text-white border-0 cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-brand-700 focus:ring-offset-2">
          <i class="fa-solid" :class="saving ? 'fa-spinner fa-spin' : 'fa-key'" aria-hidden="true"></i>
          {{ saving ? 'Đang đổi…' : 'Đổi mật khẩu' }}
        </button>
      </div>
    </form>
  </section>
</template>
