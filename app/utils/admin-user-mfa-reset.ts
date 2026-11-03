/**
 * Break-glass "Xoá xác thực hai bước" của một tài khoản quản trị KHÁC — nút ở `/admin/users`
 * (`components/admin/UserMfaResetButton.vue`), gọi `DELETE /api/admin/users/:id/mfa`
 * (`server/api/admin/users/[id]/mfa.delete.ts`). Runbook khoá ngoài MFA:
 * `docs/decisions/realm-safety.md` § "MFA bắt buộc — khoá ngoài & break-glass", bước 2.
 *
 * Ai thấy nút: đúng cách máy chủ kiểm — chỉ `isSuperAdmin === true` (giá trị "trông như đúng"
 * như `'true'`/`1` không tính, như handler), KHÔNG phải `users.update`. Không hiện trên hàng
 * của chính mình: handler không chặn tự xoá, nhưng yếu tố của chính mình gỡ ở `/admin/profile`
 * (đòi mật khẩu hiện tại) — nút này không được là lối tắt bỏ qua bước đó.
 *
 * Xác nhận: một hộp nguy hiểm nêu hậu quả và bắt gõ đúng tên tài khoản (`prompt`, mẫu của
 * `pages/admin/readers/[id].vue`). Bấm Hủy hay gõ sai thì không gửi gì.
 *
 * Tách khỏi component để hàm gọi API chạy được trong test không cần mount
 * (tests/admin-user-mfa-reset-ui.test.ts); component chỉ nối `useConfirm`/`adminFetch`/`useToast`.
 */
import type { PromptOptions } from '../composables/useConfirm'
import { errorMessage } from './errorMessage'

/** Người đang đăng nhập, như `useAdminAuth().user` giữ (`AdminSessionUser`). */
export interface MfaResetActor {
  id?: number | string | null
  isSuperAdmin?: unknown
}

/** Một hàng của danh sách người dùng (`AdminUserRow`). */
export interface MfaResetTarget {
  id: number | string
  username: string
}

const positiveId = (value: unknown): number | null => {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/** Nút hiện khi: người xem là SuperAdmin (đúng `=== true`) và hàng là tài khoản khác. */
export function canResetUserMfa(actor: MfaResetActor | null | undefined, target: MfaResetTarget): boolean {
  if (actor?.isSuperAdmin !== true) return false
  const self = positiveId(actor.id)
  const other = positiveId(target.id)
  // Không biết mình là ai thì không thể chắc hàng này không phải chính mình.
  return self !== null && other !== null && self !== other
}

export function userMfaResetPath(target: MfaResetTarget): string {
  return `/api/admin/users/${Number(target.id)}/mfa`
}

/** Hộp xác nhận: hậu quả cụ thể, rồi ô gõ tên tài khoản. */
export function mfaResetPrompt(target: MfaResetTarget): PromptOptions {
  return {
    title: 'Xoá xác thực hai bước',
    message: `Xoá MỌI yếu tố xác thực hai bước (ứng dụng xác thực, mã qua email, mật khẩu thứ hai) `
      + `và mọi mã dự phòng của tài khoản "${target.username}".\n\n`
      // Re-enrolment is required only where the MFA policy covers the account
      // (`server/utils/mfa/policy.ts`, `mfa_policy` ≠ `off`); otherwise the next sign-in is the
      // password alone (`auth/login.post.ts`: no active factor → no challenge).
      + 'Tài khoản bị đăng xuất khỏi mọi phiên. Nếu hệ thống đang bắt buộc xác thực hai bước với tài khoản này, '
      + 'người đó phải đăng ký lại; nếu không, lần đăng nhập sau chỉ cần mật khẩu. '
      + 'Chỉ dùng khi người này bị khoá ngoài (mất thiết bị, mất mã dự phòng). '
      + 'Không thể hoàn tác; thao tác được ghi vào nhật ký hoạt động của cả hai tài khoản.',
    label: `Gõ tên tài khoản "${target.username}" để xác nhận`,
    placeholder: '',
    confirmLabel: 'Xoá xác thực hai bước',
    danger: true,
  }
}

/**
 * Chữ gõ vào phải đúng tên tài khoản (bỏ khoảng trắng hai đầu, phân biệt hoa/thường); `null` =
 * đã bấm Hủy. Cả hai vế chuẩn hoá NFC trước khi so: bộ gõ tiếng Việt có thể gửi "ễ" dạng tổ hợp
 * (NFD) — cùng chữ trên màn hình, khác chuỗi.
 */
export function mfaResetConfirmed(typed: string | null, target: MfaResetTarget): boolean {
  return typed !== null && typed.trim().normalize('NFC') === target.username.normalize('NFC')
}

export interface MfaResetDeps {
  prompt: (options: PromptOptions) => Promise<string | null>
  request: (url: string, options: { method: 'DELETE' }) => Promise<{ ok?: boolean, message?: string }>
  toast: {
    success: (message: string) => void
    warning: (message: string) => void
    error: (message: string) => void
  }
}

export type MfaResetOutcome = 'cancelled' | 'mismatch' | 'cleared' | 'failed'

/**
 * Hỏi, kiểm tên đã gõ, rồi gửi đúng một `DELETE` không thân. Thành công → câu của máy chủ
 * (nêu tên tài khoản); lỗi → câu máy chủ soạn (403 "Chỉ quản trị viên cấp cao…", 404), không
 * bao giờ dòng `[DELETE] "…"` của ofetch.
 */
export async function resetUserMfa(target: MfaResetTarget, deps: MfaResetDeps): Promise<MfaResetOutcome> {
  const typed = await deps.prompt(mfaResetPrompt(target))
  if (typed === null) return 'cancelled'
  if (!mfaResetConfirmed(typed, target)) {
    deps.toast.warning(`Tên tài khoản không khớp "${target.username}" — chưa xoá gì.`)
    return 'mismatch'
  }
  try {
    const res = await deps.request(userMfaResetPath(target), { method: 'DELETE' })
    deps.toast.success(res?.message || `Đã xoá xác thực hai bước của tài khoản "${target.username}".`)
    return 'cleared'
  } catch (err: unknown) {
    deps.toast.error(errorMessage(err, 'Không xoá được xác thực hai bước của tài khoản này.'))
    return 'failed'
  }
}
