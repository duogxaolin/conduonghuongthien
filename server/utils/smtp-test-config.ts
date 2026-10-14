import type { SmtpConfig } from './mailer'

/** The token the settings GET returns in place of a saved SMTP password. */
export const MASKED_SMTP_PASSWORD = '********'

const isTruthy = (value: unknown) => ['true', '1', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase())

/**
 * Cổng SMTP được phép: 25 (relay), 465 (TLS ngầm), 587 (submission), 2525 (cổng
 * thay thế phổ biến của các dịch vụ gửi thư). Mọi cổng khác bị từ chối cả lúc LƯU
 * cấu hình lẫn lúc GỬI THỬ — không có trần này thì ô "cổng" biến máy chủ thành
 * công cụ dò cổng nội bộ (Redis 6379, MySQL 3306…), và một cổng lạ đã lưu sẽ bị
 * mọi email thông báo quay số lại.
 */
export const SMTP_ALLOWED_PORTS: readonly number[] = Object.freeze([25, 465, 587, 2525])

/** Cổng hiệu lực của một giá trị nhập (rỗng → 587, như `getSmtpConfig`); `null` nếu không phải số nguyên. */
export function effectiveSmtpPort(value: unknown): number | null {
  const text = String(value ?? '').trim()
  if (!text) return 587
  if (!/^\d{1,5}$/.test(text)) return null
  return Number(text)
}

export function isAllowedSmtpPort(port: number | null): boolean {
  return port !== null && SMTP_ALLOWED_PORTS.includes(port)
}

export const SMTP_PORT_NOT_ALLOWED_MESSAGE = `Cổng SMTP không được phép. Chỉ nhận ${SMTP_ALLOWED_PORTS.join(', ')}.`

/** Đích kết nối SMTP hiệu lực — chuẩn hoá giống hệt `getSmtpConfig` để so "có đổi máy chủ không". */
export interface SmtpTarget {
  host: string
  port: number | null
  user: string
  secure: boolean
}

export function smtpTargetOf(values: { smtp_host?: unknown, smtp_port?: unknown, smtp_user?: unknown, smtp_secure?: unknown }): SmtpTarget {
  return {
    // Tên máy không phân biệt hoa/thường: đổi chữ hoa không phải đổi đích.
    host: String(values.smtp_host ?? '').trim().toLowerCase(),
    port: effectiveSmtpPort(values.smtp_port),
    user: String(values.smtp_user ?? '').trim(),
    secure: isTruthy(values.smtp_secure),
  }
}

export function sameSmtpTarget(a: SmtpTarget, b: SmtpTarget): boolean {
  return a.host === b.host && a.port === b.port && a.user === b.user && a.secure === b.secure
}

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
  return pass === MASKED_SMTP_PASSWORD || pass === '' || !String(body?.smtp_host ?? '').trim()
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
