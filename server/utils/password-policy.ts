/**
 * Password rules for administrator accounts.
 *
 * The portal previously accepted any six characters — for accounts that can
 * publish to a Ministry of Public Security site, create other administrators
 * and read citizens' submitted contact details. Twelve characters with mixed
 * classes is the floor here; it is not onerous for a handful of staff accounts
 * and it removes the whole class of guessable credentials.
 *
 * The rules apply when a password is *set*, never at login: an existing account
 * with a short password keeps working. Locking staff out of a live government
 * portal to enforce a policy retroactively would be the worse failure.
 */

export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_LENGTH = 128
/** Of lower / upper / digit / symbol, how many must appear. */
export const PASSWORD_MIN_CLASSES = 3

/**
 * Passwords that are public knowledge for this project or that top every
 * credential-stuffing list. `Admin@123456` is the documented seed default, so
 * it is the single most likely password on any fresh install.
 */
const FORBIDDEN = new Set([
  'admin@123456', 'admin@1234', 'admin123456', 'admin1234', 'administrator',
  'password', 'password1', 'password123', 'p@ssw0rd', 'p@ssword123',
  'matkhau123', 'matkhau@123', 'conduonghuongthien', 'cdkt@123456',
  'qwertyuiop', '123456789012', '1234567890', 'abcd1234', 'iloveyou',
  'welcome123', 'letmein123', 'changeme123', 'default123',
  'doimatkhaumanhngaylandau!', 'doimatkhaumanhngaylandau',
])

export type PasswordCheck = { ok: boolean; errors: string[] }

const countClasses = (value: string) =>
  [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(pattern => pattern.test(value)).length

/** Three or more identical characters in a row: "aaa", "111". */
const hasRun = (value: string) => /(.)\1{2,}/.test(value)

/** Four or more consecutive code points: "abcd", "1234", "4321". */
function hasSequence(value: string): boolean {
  const lower = value.toLowerCase()
  let ascending = 1
  let descending = 1
  for (let i = 1; i < lower.length; i += 1) {
    const step = lower.charCodeAt(i) - lower.charCodeAt(i - 1)
    ascending = step === 1 ? ascending + 1 : 1
    descending = step === -1 ? descending + 1 : 1
    if (ascending >= 4 || descending >= 4) return true
  }
  return false
}

/**
 * Validate a candidate password. Every failing rule is reported at once so the
 * person fixes them in one edit instead of discovering them one at a time.
 */
export function validatePassword(password: unknown, context: { username?: string } = {}): PasswordCheck {
  const value = typeof password === 'string' ? password : ''
  const errors: string[] = []

  if (value.length < PASSWORD_MIN_LENGTH) {
    errors.push(`Mật khẩu phải có ít nhất ${PASSWORD_MIN_LENGTH} ký tự.`)
  }
  if (value.length > PASSWORD_MAX_LENGTH) {
    errors.push(`Mật khẩu không được vượt quá ${PASSWORD_MAX_LENGTH} ký tự.`)
  }
  if (value.trim() !== value) {
    errors.push('Mật khẩu không được bắt đầu hoặc kết thúc bằng khoảng trắng.')
  }
  if (countClasses(value) < PASSWORD_MIN_CLASSES) {
    errors.push('Mật khẩu phải kết hợp ít nhất 3 trong 4 nhóm: chữ thường, chữ hoa, chữ số, ký tự đặc biệt.')
  }

  const normalized = value.toLowerCase()
  if (FORBIDDEN.has(normalized)) {
    errors.push('Mật khẩu này nằm trong danh sách mật khẩu phổ biến hoặc mặc định. Vui lòng chọn mật khẩu khác.')
  }

  const username = String(context.username || '').trim().toLowerCase()
  if (username.length >= 3 && normalized.includes(username)) {
    errors.push('Mật khẩu không được chứa tên đăng nhập.')
  }

  // Runs and sequences are what make a *human-chosen* password guessable. A long
  // mixed-class string from `openssl rand` can contain "aaa" by chance, and
  // failing a fresh install over that would be baffling and pointless.
  const highEntropy = value.length >= 20 && countClasses(value) >= 3
  if (!highEntropy) {
    if (hasRun(value)) {
      errors.push('Mật khẩu không được có 3 ký tự giống nhau liên tiếp.')
    }
    if (hasSequence(value)) {
      errors.push('Mật khẩu không được chứa chuỗi ký tự liên tiếp (ví dụ: 1234, abcd).')
    }
  }

  return { ok: errors.length === 0, errors }
}

/** Convenience for handlers: the joined message, or null when the password passes. */
export function passwordRejectionMessage(password: unknown, context: { username?: string } = {}): string | null {
  const { ok, errors } = validatePassword(password, context)
  return ok ? null : errors.join(' ')
}
