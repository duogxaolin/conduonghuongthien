import { createMfaEnrollmentHandler } from '../utils/mfa-enrollment-redirect'

/**
 * Chính sách bắt buộc MFA tới hạn GIỮA phiên (kiểm chứng 2A, S4): lượt gọi API kế
 * tiếp của một trang quản trị đang mở nhận 403 `mfa_enrollment_required`. Thay vì để
 * mỗi trang hiện một lỗi rời rạc, gắn MỘT hook `onResponseError` vào `$fetch` toàn
 * cục: đánh dấu tài khoản phải bật MFA (banner) và chuyển về `/admin/profile#security`.
 *
 * `$fetch.create` giữ nguyên mọi mặc định của bản gốc (ofetch gộp `defaults`); hook
 * chỉ phản ứng đúng mã đó, mọi lỗi khác đi tiếp như cũ tới `catch` của trang. Không
 * trang nào truyền `onResponseError` riêng (nếu truyền, tuỳ chọn của lượt gọi đè hook
 * này — ofetch `{ ...defaults, ...input }`).
 */
export default defineNuxtPlugin({
  name: 'cdkt:mfa-enrollment-redirect',
  setup() {
    const { user } = useAdminAuth()
    const router = useRouter()
    const onResponseError = createMfaEnrollmentHandler({
      currentPath: () => router.currentRoute.value.path,
      onRequired: () => {
        if (user.value && user.value.mfaEnrollmentRequired !== true) {
          user.value = { ...user.value, mfaEnrollmentRequired: true }
        }
      },
      navigate: to => navigateTo(to),
    })
    globalThis.$fetch = globalThis.$fetch.create({ onResponseError }) as typeof globalThis.$fetch
  },
})
