/**
 * Phản ứng phía trình duyệt với 403 `mfa_enrollment_required` (chính sách MFA,
 * `server/utils/mfa/policy.ts`) GIỮA phiên — middleware route chỉ chạy khi chuyển
 * trang, còn mốc cưỡng chế có thể qua lúc cán bộ đang mở một trang. Gắn vào `$fetch`
 * toàn cục bởi `app/plugins/mfa-enrollment-redirect.client.ts`.
 *
 * Hàm thuần (không chạm Nuxt) để test chạy được bằng runner Node.
 */

/** Phải trùng `MFA_ENROLLMENT_REQUIRED_CODE` phía máy chủ (test so hai hằng). */
export const MFA_ENROLLMENT_REQUIRED_CODE = 'mfa_enrollment_required'

export const MFA_ENROLLMENT_ROUTE = Object.freeze({ path: '/admin/profile', hash: '#security' })

/** Thân lỗi h3: `{ statusCode, statusMessage, data: { code } }`. */
export function isMfaEnrollmentRequiredResponse(status: number | undefined, body: unknown): boolean {
  if (status !== 403 || !body || typeof body !== 'object') return false
  const data = (body as { data?: unknown }).data
  return !!data && typeof data === 'object' && (data as { code?: unknown }).code === MFA_ENROLLMENT_REQUIRED_CODE
}

export function createMfaEnrollmentHandler(deps: {
  currentPath: () => string
  /** Đánh dấu tài khoản đang bị khoá — banner đổi sang "phải bật ngay". */
  onRequired: () => void
  navigate: (to: { path: string, hash: string }) => unknown
}) {
  return async ({ response }: { response?: { status?: number, _data?: unknown } }): Promise<void> => {
    if (!response || !isMfaEnrollmentRequiredResponse(response.status, response._data)) return
    deps.onRequired()
    if (deps.currentPath() !== MFA_ENROLLMENT_ROUTE.path) {
      await deps.navigate({ path: MFA_ENROLLMENT_ROUTE.path, hash: MFA_ENROLLMENT_ROUTE.hash })
    }
  }
}
