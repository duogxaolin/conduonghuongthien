/**
 * What `/admin/profile` says about each second factor, and which factors can be enrolled
 * right now. Shared by the factor cards and the enroll/disable dialogs
 * (`app/components/admin/profile/*`). Pure: no request, no DOM.
 */
import type { FactorType, MfaFactorMeta, MfaStatus } from '../types/admin-profile'

export const MFA_FACTOR_META: Record<FactorType, MfaFactorMeta> = {
  totp: {
    label: 'Ứng dụng xác thực (Google Authenticator)',
    icon: 'fa-solid fa-mobile-screen-button',
    desc: 'Mã 6 số đổi mỗi 30 giây, sinh ngay trên điện thoại — không cần mạng.',
  },
  email_otp: {
    label: 'Mã OTP gửi về email',
    icon: 'fa-solid fa-envelope',
    desc: 'Mỗi lần đăng nhập, hệ thống gửi mã 6 số về email của bạn. Mã sống 10 phút.',
  },
  second_password: {
    label: 'Mật khẩu cấp 2',
    icon: 'fa-solid fa-key',
    desc: 'Một mật khẩu riêng, khác mật khẩu đăng nhập, hỏi thêm ở bước thứ hai.',
  },
}

/** Email OTP cần SMTP (và một email trên tài khoản); các yếu tố khác thì không. */
export function canEnrollMfaFactor(type: FactorType, status: Pick<MfaStatus, 'smtpReady' | 'email'> | null | undefined): boolean {
  if (type !== 'email_otp') return true
  return status?.smtpReady === true && !!status?.email
}
