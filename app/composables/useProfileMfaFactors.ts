import { reactive } from 'vue'

// Relative paths, not `~/`: the page's tests load this file through Node, and the test
// loader (scripts/ts-resolver.mjs) only knows `~~/`.
import { adminFetch } from './adminFetch'
import { errorMessage } from '../utils/errorMessage'
import type { useToast } from './useToast'
import type { FactorType, MfaConfirmResponse, MfaDisableResponse, MfaEnrollResponse } from '../types/admin-profile'

/**
 * The two factor dialogs of `/admin/profile`: turn a factor on (enroll → confirm, with
 * "Gửi lại mã" for email) and turn one off. Moved out of the page when it was split (wave3
 * 4.1); the markup is `ProfileEnrollDialog.vue` / `ProfileDisableDialog.vue`. The page
 * keeps the factor state and its load/error/retry contract, and hands in its toast, its
 * focus helper and what each flow re-reads afterwards — so this file needs no Nuxt
 * auto-import (tests/admin-profile-page.test.ts drives it through the page's controls).
 *
 * Two rules, both new in the split (each pinned by a test that was red before it):
 *   - SESSION. Opening or closing a dialog starts a new session. An answer that lands
 *     after its dialog was closed ("Huỷ", ✕ and the backdrop close it even while busy) or
 *     reopened for another factor writes NOTHING into the dialog — no error, no step
 *     change, no close, no focus move. What the server DID still happens (the toast, the
 *     one-time recovery codes, the re-reads), because it happened.
 *   - ONE REQUEST AT A TIME. The buttons are disabled while busy; Enter in a field was not,
 *     and a second Enter sent a second request.
 */

type Toast = Pick<ReturnType<typeof useToast>, 'success' | 'info'>

/** Recovery codes the confirm of a FIRST factor may carry (MFA policy) — see useProfileRecoveryCodes. */
export interface ConfirmCodes {
  /** Taken when the request is sent, so a later batch is never replaced by an earlier answer. */
  ticket: () => number
  reveal: (ticket: number, codes: string[]) => void
}

export interface MfaEnrollDeps {
  toast: Toast
  /** Move focus into a field of the dialog once it is rendered. */
  focusField: (id: string) => void
  codes: ConfirmCodes
  /** After a factor is turned on: the page re-reads the status, the history and `me`. */
  afterEnabled: () => Promise<unknown>
}

export function useMfaEnrollDialog({ toast, focusField, codes, afterEnabled }: MfaEnrollDeps) {
  const enrollDialog = reactive({
    open: false,
    factorType: 'totp' as FactorType,
    stage: 'password' as 'password' | 'confirm',
    currentPassword: '',
    secondPassword: '',
    secondPasswordConfirm: '',
    totpSecret: '',
    otpauthUri: '',
    sentTo: '',
    code: '',
    busy: false,
    error: '',
  })
  let session = 0

  function openEnroll(type: FactorType) {
    session += 1
    Object.assign(enrollDialog, {
      open: true, factorType: type, stage: 'password',
      currentPassword: '', secondPassword: '', secondPasswordConfirm: '',
      totpSecret: '', otpauthUri: '', sentTo: '', code: '', busy: false, error: '',
    })
    focusField('enroll-pw')
  }

  function closeEnroll() {
    session += 1
    enrollDialog.open = false
    // Bí mật TOTP chỉ hiện một lần; xoá khỏi bộ nhớ trang ngay khi đóng.
    enrollDialog.totpSecret = ''
    enrollDialog.otpauthUri = ''
    enrollDialog.currentPassword = ''
    enrollDialog.secondPassword = ''
    enrollDialog.secondPasswordConfirm = ''
    enrollDialog.code = ''
  }

  async function submitEnroll() {
    if (enrollDialog.busy) return
    enrollDialog.error = ''
    if (!enrollDialog.currentPassword) {
      enrollDialog.error = 'Vui lòng nhập mật khẩu hiện tại.'
      return
    }
    if (enrollDialog.factorType === 'second_password') {
      if (!enrollDialog.secondPassword) {
        enrollDialog.error = 'Vui lòng nhập mật khẩu cấp 2.'
        return
      }
      if (enrollDialog.secondPassword !== enrollDialog.secondPasswordConfirm) {
        enrollDialog.error = 'Mật khẩu cấp 2 và ô nhập lại không khớp.'
        return
      }
    }
    const mine = session
    enrollDialog.busy = true
    try {
      const res = await adminFetch<MfaEnrollResponse>('/api/admin/profile/mfa/enroll', {
        method: 'POST',
        body: {
          factorType: enrollDialog.factorType,
          currentPassword: enrollDialog.currentPassword,
          ...(enrollDialog.factorType === 'second_password' ? { secondPassword: enrollDialog.secondPassword } : {}),
        },
      })
      // Closed or reopened meanwhile: the secret goes with the dialog it was meant for.
      if (mine !== session) return
      enrollDialog.totpSecret = ('secret' in res && res.secret) || ''
      enrollDialog.otpauthUri = ('otpauthUri' in res && res.otpauthUri) || ''
      enrollDialog.sentTo = ('sentTo' in res && res.sentTo) || ''
      enrollDialog.stage = 'confirm'
      // Bước 2 thay hẳn nội dung hộp thoại, nên tiêu điểm phải đi theo.
      focusField(enrollDialog.factorType === 'second_password' ? 'enroll-sp-confirm' : 'enroll-code')
    } catch (err: unknown) {
      if (mine === session) enrollDialog.error = errorMessage(err, 'Không bắt đầu được việc bật xác thực.')
    } finally {
      if (mine === session) enrollDialog.busy = false
    }
  }

  async function submitConfirm() {
    if (enrollDialog.busy) return
    enrollDialog.error = ''
    const needsCode = enrollDialog.factorType !== 'second_password'
    const value = needsCode ? enrollDialog.code.trim() : enrollDialog.secondPassword
    if (!value) {
      enrollDialog.error = needsCode ? 'Vui lòng nhập mã xác thực.' : 'Vui lòng nhập lại mật khẩu cấp 2.'
      return
    }
    const mine = session
    const ticket = codes.ticket()
    enrollDialog.busy = true
    try {
      const res = await adminFetch<MfaConfirmResponse>('/api/admin/profile/mfa/confirm', {
        method: 'POST',
        body: { factorType: enrollDialog.factorType, code: value },
      })
      toast.success(res.message || 'Đã bật xác thực hai bước.')
      // Chính sách MFA đang bật: máy chủ phát mã dự phòng ngay trong lượt này — hiện
      // một lần ở khung "mã dự phòng" như khi tự tạo. Kể cả khi hộp thoại đã đóng: mã
      // không tồn tại ở đâu khác.
      if ('recoveryCodes' in res && res.recoveryCodes?.length) codes.reveal(ticket, res.recoveryCodes)
      if (mine === session) closeEnroll()
      // Cookie phiên đã được cấp lại trong chính phản hồi; đọc lại `me` để banner và
      // chốt chuyển trang của chính sách MFA biết tài khoản đã có yếu tố.
      await afterEnabled()
    } catch (err: unknown) {
      if (mine !== session) return
      enrollDialog.error = errorMessage(err, 'Mã không đúng.')
      if (needsCode) enrollDialog.code = ''
    } finally {
      if (mine === session) enrollDialog.busy = false
    }
  }

  async function resendEnrollCode() {
    enrollDialog.error = ''
    const mine = session
    enrollDialog.busy = true
    try {
      // Gửi lại bằng cách chạy lại bước enroll: server thay mã cũ bằng mã mới.
      const res = await adminFetch<MfaEnrollResponse>('/api/admin/profile/mfa/enroll', {
        method: 'POST',
        body: { factorType: 'email_otp', currentPassword: enrollDialog.currentPassword },
      })
      if (mine === session) enrollDialog.sentTo = ('sentTo' in res && res.sentTo) || enrollDialog.sentTo
      toast.info('Đã gửi lại mã mới. Mã cũ không còn dùng được.')
    } catch (err: unknown) {
      if (mine === session) enrollDialog.error = errorMessage(err, 'Không gửi lại được mã.')
    } finally {
      if (mine === session) enrollDialog.busy = false
    }
  }

  return { enrollDialog, openEnroll, closeEnroll, submitEnroll, submitConfirm, resendEnrollCode }
}

export interface MfaDisableDeps {
  toast: Toast
  focusField: (id: string) => void
  /** After a factor is turned off: the page re-reads the status and the history. */
  afterDisabled: () => Promise<unknown>
}

export function useMfaDisableDialog({ toast, focusField, afterDisabled }: MfaDisableDeps) {
  const disableDialog = reactive({
    open: false,
    factorType: 'totp' as FactorType,
    currentPassword: '',
    busy: false,
    error: '',
  })
  let session = 0

  function openDisable(type: FactorType) {
    session += 1
    Object.assign(disableDialog, { open: true, factorType: type, currentPassword: '', busy: false, error: '' })
    focusField('disable-pw')
  }

  function closeDisable() {
    session += 1
    disableDialog.open = false
    disableDialog.currentPassword = ''
  }

  async function submitDisable() {
    if (disableDialog.busy) return
    disableDialog.error = ''
    if (!disableDialog.currentPassword) {
      disableDialog.error = 'Vui lòng nhập mật khẩu hiện tại.'
      return
    }
    const mine = session
    disableDialog.busy = true
    try {
      const res = await adminFetch<MfaDisableResponse>('/api/admin/profile/mfa/disable', {
        method: 'POST',
        body: { factorType: disableDialog.factorType, currentPassword: disableDialog.currentPassword },
      })
      toast.success(res.message || 'Đã tắt yếu tố xác thực.')
      if (mine === session) closeDisable()
      await afterDisabled()
    } catch (err: unknown) {
      if (mine === session) disableDialog.error = errorMessage(err, 'Không tắt được yếu tố xác thực.')
    } finally {
      if (mine === session) disableDialog.busy = false
    }
  }

  return { disableDialog, openDisable, closeDisable, submitDisable }
}
