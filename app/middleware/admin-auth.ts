import { MFA_ENROLLMENT_ROUTE, isMfaEnrollmentPage } from '../utils/mfa-enrollment-redirect'

export default defineNuxtRouteMiddleware(async (to) => {
  const { user, fetchUser } = useAdminAuth()

  // Trang login: nếu đã đăng nhập → redirect /admin, không cho vào lại.
  if (to.path === '/admin/login') {
    if (!user.value) await fetchUser()
    if (user.value) return navigateTo('/admin')
    return
  }

  if (!user.value) {
    await fetchUser()
  }

  if (!user.value) {
    return navigateTo('/admin/login')
  }

  // Chính sách bắt buộc MFA đã tới hạn mà tài khoản chưa bật yếu tố nào: máy chủ
  // từ chối mọi API admin ngoài trang bật MFA (403 `mfa_enrollment_required`), nên
  // đưa thẳng về đó thay vì để từng trang hiện lỗi.
  if (user.value.mfaEnrollmentRequired && !isMfaEnrollmentPage(to.path)) {
    return navigateTo({ path: MFA_ENROLLMENT_ROUTE.path, hash: MFA_ENROLLMENT_ROUTE.hash })
  }
})
