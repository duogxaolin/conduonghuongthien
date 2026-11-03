import type { SmtpConfig } from './mailer'
import {
  MASKED_SECRET,
  SMTP_ALLOWED_PORTS,
  SMTP_PORT_NOT_ALLOWED_MESSAGE,
  effectiveSmtpPort,
  isAllowedSmtpPort,
  isTruthy,
  sameSmtpTarget,
  smtpTargetOf,
} from '../../shared/settings-credential-rules'

/**
 * Luật đích SMTP (cổng cho phép, chuẩn hoá đích, dấu che mật khẩu) là của
 * `shared/settings-credential-rules.ts` — cùng bản mà nút "lưu" (`settings/index.put.ts`)
 * và trang `email.vue` dùng. Tệp này chỉ re-export chúng dưới tên endpoint "gửi thử"
 * vẫn import, và giữ phần riêng của nút gửi thử (phân loại lỗi, chọn cấu hình).
 * Đừng chép lại luật nào ở đây: hai bản lệch nhau là "gửi thử" và "lưu" quyết khác.
 */
export {
  MASKED_SECRET as MASKED_SMTP_PASSWORD,
  SMTP_ALLOWED_PORTS,
  SMTP_PORT_NOT_ALLOWED_MESSAGE,
  effectiveSmtpPort,
  isAllowedSmtpPort,
  sameSmtpTarget,
  smtpTargetOf,
}
export type { SmtpTarget } from '../../shared/settings-credential-rules'

/**
 * Lỗi gửi thử trả về cho cán bộ: chỉ một câu đã phân loại, KHÔNG BAO GIỜ nguyên
 * văn `err.message` của nodemailer — chuỗi đó chứa IP:cổng nội bộ, banner máy
 * chủ, phản hồi SMTP thô, nghĩa là một kênh đọc ngược cho người dò mạng nội bộ.
 * Cố ý gộp "bị từ chối kết nối", "không phân giải được tên" và lỗi socket thành
 * một lớp: tách chúng ra chính là tín hiệu "cổng mở/đóng" của máy dò cổng.
 * Mã lỗi lấy từ `nodemailer/dist/esm/errors.js`.
 */
export type SmtpFailureClass = 'connect' | 'timeout' | 'auth' | 'tls' | 'rejected' | 'unknown'

export function classifySmtpError(error: unknown): SmtpFailureClass {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code ?? '') : ''
  switch (code) {
    case 'ECONNECTION':
    case 'ESOCKET':
    case 'EDNS':
    case 'ECONNREFUSED':
    case 'ECONNRESET':
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
    case 'ENOTFOUND':
      return 'connect'
    case 'ETIMEDOUT':
      return 'timeout'
    case 'EAUTH':
    case 'ENOAUTH':
      return 'auth'
    case 'ETLS':
    case 'EREQUIRETLS':
      return 'tls'
    case 'EENVELOPE':
    case 'EMESSAGE':
    case 'EPROTOCOL':
      return 'rejected'
    default:
      return 'unknown'
  }
}

export function smtpFailureMessage(kind: SmtpFailureClass): string {
  switch (kind) {
    case 'connect': return 'Không kết nối được tới máy chủ SMTP. Kiểm tra lại host và cổng.'
    case 'timeout': return 'Máy chủ SMTP không phản hồi kịp (hết thời gian chờ).'
    case 'auth': return 'Máy chủ SMTP từ chối đăng nhập. Kiểm tra lại tài khoản và mật khẩu.'
    case 'tls': return 'Lỗi thiết lập kết nối bảo mật (TLS/STARTTLS). Kiểm tra lại cổng và tuỳ chọn bảo mật.'
    case 'rejected': return 'Máy chủ SMTP từ chối thư (người gửi, người nhận hoặc nội dung).'
    default: return 'Lỗi kết nối SMTP.'
  }
}

/**
 * True when the "send test email" request must run on the SAVED config: the
 * password field still carries the mask (or is blank), or no host was given.
 */
export function smtpTestUsesSavedConfig(body: Record<string, unknown> | null | undefined): boolean {
  const pass = String(body?.smtp_pass ?? '')
  return pass === MASKED_SECRET || pass === '' || !String(body?.smtp_host ?? '').trim()
}

export interface SmtpTestConfigDecision {
  config: SmtpConfig | null
  usedSaved: boolean
  /** The body named a different server than the saved one, and it was NOT used. */
  ignoredUnsavedChanges: boolean
}

/**
 * Decide which SMTP config the "send test email" endpoint may use.
 *
 * The saved password never leaves the server and is only ever paired with the
 * SAVED host/port/user/from. A request that still carries the mask (or no
 * password) therefore tests the saved config as a whole and ignores every
 * connection field in the body — otherwise the endpoint would log in to a host
 * the caller picked using the stored password (handing the password to that
 * host) and double as an internal port scanner. To try a different server before
 * saving, the admin must type that server's password; the typed password is used
 * as is, with no fallback to the stored one.
 */
export function resolveSmtpTestConfig(
  body: Record<string, unknown> | null | undefined,
  saved: SmtpConfig | null,
): SmtpTestConfigDecision {
  if (smtpTestUsesSavedConfig(body)) {
    const bodyHost = String(body?.smtp_host ?? '').trim()
    const ignoredUnsavedChanges = !!saved && !!bodyHost && !sameSmtpTarget(
      smtpTargetOf(body ?? {}),
      smtpTargetOf({ smtp_host: saved.host, smtp_port: saved.port, smtp_user: saved.user, smtp_secure: saved.secure }),
    )
    return { config: saved, usedSaved: true, ignoredUnsavedChanges }
  }

  const user = String(body?.smtp_user ?? '').trim()
  if (!user) return { config: null, usedSaved: false, ignoredUnsavedChanges: false }
  return {
    config: {
      host: String(body?.smtp_host ?? '').trim(),
      // 0 = không đọc được thành số nguyên → endpoint từ chối qua `isAllowedSmtpPort`.
      port: effectiveSmtpPort(body?.smtp_port) ?? 0,
      secure: isTruthy(body?.smtp_secure),
      user,
      pass: String(body?.smtp_pass ?? ''),
      from: String(body?.smtp_from ?? '').trim() || user,
    },
    usedSaved: false,
    ignoredUnsavedChanges: false,
  }
}
