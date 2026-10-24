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

/** Đã ở trang hồ sơ? `/admin/profile/`, `?…`, `#…` đều tính (kiểm chứng lại 2A, S2). */
export function isMfaEnrollmentPage(path: string): boolean {
  const bare = (path.split(/[?#]/)[0] ?? '').replace(/\/+$/, '')
  return bare === MFA_ENROLLMENT_ROUTE.path
}

export function createMfaEnrollmentHandler(deps: {
  currentPath: () => string
  /** Đánh dấu tài khoản đang bị khoá — banner đổi sang "phải bật ngay". */
  onRequired: () => void
  navigate: (to: { path: string, hash: string }) => unknown
}) {
  /**
   * Một trang bắn nhiều request cùng lúc → một loạt 403 cùng lúc. Chỉ lượt đầu
   * chuyển trang; các lượt sau trong cùng loạt chờ chính lượt chuyển đó. Cờ được
   * gỡ khi lượt chuyển xong, nên một loạt về sau (cán bộ lại sang trang khác) vẫn
   * được xử lý.
   */
  let inFlight: Promise<unknown> | null = null
  return async ({ response }: { response?: { status?: number, _data?: unknown } }): Promise<void> => {
    if (!response || !isMfaEnrollmentRequiredResponse(response.status, response._data)) return
    deps.onRequired()
    if (isMfaEnrollmentPage(deps.currentPath())) return
    if (inFlight) {
      await inFlight
      return
    }
    inFlight = Promise.resolve(deps.navigate({ path: MFA_ENROLLMENT_ROUTE.path, hash: MFA_ENROLLMENT_ROUTE.hash }))
      .finally(() => { inFlight = null })
    await inFlight
  }
}
