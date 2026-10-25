<script setup lang="ts">
import { isMfaEnrollmentPage } from '~/utils/mfa-enrollment-redirect'

/**
 * Banner chính sách bắt buộc MFA (spec admin-mfa-policy): tài khoản thuộc diện mà
 * chưa bật yếu tố nào được báo NGÀY bắt đầu cưỡng chế trong thời hạn chuyển tiếp,
 * và được báo rằng các trang khác đã khoá khi quá hạn. Chỉ đọc hai trường mà
 * `auth/me` (và phản hồi đăng nhập) trả — không tự gọi API.
 */
const { user } = useAdminAuth()
const route = useRoute()

const enforceAfter = computed(() => {
  const raw = user.value?.mfaEnforceAfter
  if (!raw) return ''
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('vi-VN', { hour12: false })
})
const required = computed(() => user.value?.mfaEnrollmentRequired === true)
const onProfile = computed(() => isMfaEnrollmentPage(route.path))
</script>

<template>
  <div
    v-if="required || enforceAfter"
    role="status"
    class="mb-4 flex flex-wrap items-start gap-2 rounded-xl border px-4 py-3 text-sm"
    :class="required ? 'border-[#ffc1ba] bg-[#ffebe9] text-[#8a1c19]' : 'border-[#f0dcae] bg-[#fdf6e7] text-[#7a5a12]'"
  >
    <i class="fa-solid fa-shield-halved mt-0.5" aria-hidden="true"></i>
    <p class="m-0 flex-1 min-w-[200px]">
      <template v-if="required">
        <strong>Tài khoản của bạn phải bật xác thực hai bước.</strong>
        Các trang quản trị khác tạm khoá cho tới khi bạn bật một phương thức ở mục "Xác thực hai bước" bên dưới.
      </template>
      <template v-else>
        Từ <strong>{{ enforceAfter }}</strong>, tài khoản của bạn phải bật xác thực hai bước để tiếp tục dùng trang quản trị.
      </template>
    </p>
    <NuxtLink
      v-if="!onProfile"
      :to="{ path: '/admin/profile', hash: '#security' }"
      class="font-bold underline focus:outline-none focus:ring-2 focus:ring-brand-600 rounded"
    >Bật ngay</NuxtLink>
  </div>
</template>
