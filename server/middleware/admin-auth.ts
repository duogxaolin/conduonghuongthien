import { getDb } from '../utils/db'
import { logWarn, SECURITY_EVENTS } from '../utils/logger'
import { users, roles, permissions } from '../db/schema'
import { verifyToken, isSessionStage } from '../utils/auth'
import { MFA_ENROLLMENT_REQUIRED_CODE, MFA_ENROLLMENT_REQUIRED_MESSAGE, resolveMfaEnrollment } from '../utils/mfa/policy'
import { eq } from 'drizzle-orm'

const ADMIN_API_PREFIX = '/api/admin/'

// Các endpoint của chính luồng đăng nhập — khớp CHÍNH XÁC trên đường dẫn đã giải mã.
// Hai endpoint MFA nằm giữa "mật khẩu đúng" và "có phiên" nên chưa thể có phiên;
// chúng tự xác thực bằng vé thử thách (cookie `cdkt_mfa`).
const EXEMPT_PATHS: ReadonlySet<string> = new Set([
  '/api/admin/auth/login',
  '/api/admin/auth/captcha',
  '/api/admin/auth/mfa/verify',
  '/api/admin/auth/mfa/send-code',
])

/**
 * Cắt query string — CHỈ `?`, đúng như router của h3 (`event.path.split('?')`).
 *
 * Bản trước cắt cả `#`. Trình duyệt không bao giờ gửi fragment, nhưng một client
 * thô thì gửi được, và router KHÔNG cắt `#`: `/api/admin/auth/login#/../users`
 * được middleware phân loại là `/api/admin/auth/login` (miễn kiểm) trong khi
 * router thấy một đường dẫn khác — một route `**` bắt được nó sẽ chạy không qua
 * phiên. Nay `#` ở lại trong đường dẫn, và mọi dạng chứa `#` không bao giờ được
 * miễn (xem `classifyAdminRequest`).
 */
function stripQuery(path: string): string {
  const cut = path.indexOf('?')
  return cut === -1 ? path : path.slice(0, cut)
}

/** Giải mã percent; chuỗi hỏng (`%zz`) giữ nguyên dạng thô để vẫn bị chặn (fail closed). */
function decodeOrKeep(path: string): string {
  try { return decodeURIComponent(path) } catch { return path }
}

/**
 * Hai câu hỏi "có phải request vào admin API?" và "có phải endpoint đăng nhập
 * được miễn?" phải được trả lời trên ĐÚNG đường dẫn mà router dùng để chọn
 * handler. h3 giải mã percent TRƯỚC khi route (`event.path` đã giải mã), còn
 * `getRequestURL().pathname` giữ nguyên `%xx`. Trước đây middleware so dạng thô
 * nên `/api/%61dmin/users` đi thẳng vào handler mà không qua token/isActive/
 * tokenVersion/MFA stage.
 *
 * Fail closed trước mọi lệch pha giữa middleware và router (kể cả khi h3/Nitro
 * dời chỗ giải mã ở bản sau):
 *  - là admin request nếu BẤT KỲ dạng nào (đường route, dạng giải mã của nó,
 *    pathname thô, dạng giải mã của pathname thô) bắt đầu bằng `/api/admin/`;
 *  - chỉ được miễn nếu MỌI dạng đã giải mã (đường route, giải mã của nó, giải
 *    mã của pathname thô) đều đúng một trong bốn endpoint. Pathname thô CHƯA
 *    giải mã không dự phần miễn trừ — nếu có thì `/api/admin/auth/log%69n` (mà
 *    router route vào login) sẽ bị 401, trái hợp đồng; nó vẫn dự phần câu hỏi
 *    "có phải admin request" nên chỉ có thể làm cổng chặt hơn.
 */
export function classifyAdminRequest(routedPath: string, rawPathname: string): { isAdmin: boolean, isExempt: boolean } {
  const { decodedForms, allForms, carriesHash } = pathForms(routedPath, rawPathname)
  const isAdmin = [...allForms].some(form => form.startsWith(ADMIN_API_PREFIX))
  const isExempt = isAdmin && !carriesHash && decodedForms.every(form => EXEMPT_PATHS.has(form))
  return { isAdmin, isExempt }
}

/**
 * Mọi dạng của một đường dẫn mà middleware và router có thể đọc khác nhau — dùng
 * chung cho hai câu hỏi "được miễn phiên?" và "được qua chốt bắt buộc MFA?".
 * `#` (thô hay `%23`) trong BẤT KỲ dạng nào của PHẦN ĐƯỜNG DẪN → `carriesHash`
 * (query đã cắt — `?next=%23x` không ảnh hưởng). `getRequestURL()` dựng pathname
 * bằng `new URL`, vốn vứt fragment, nên dạng đó có thể trông "sạch"; `routed` thì
 * vẫn mang `#`, và nó nằm trong `allForms`.
 */
function pathForms(routedPath: string, rawPathname: string): { decodedForms: string[], allForms: Set<string>, carriesHash: boolean } {
  const routed = stripQuery(routedPath || '/')
  const decodedForms = [...new Set([routed, decodeOrKeep(routed), decodeOrKeep(rawPathname)])]
  const allForms = new Set([...decodedForms, rawPathname])
  const carriesHash = [...allForms].some(form => form.includes('#') || /%23/i.test(form))
  return { decodedForms, allForms, carriesHash }
}

/**
 * Endpoint vẫn mở cho tài khoản đang bị chốt "phải bật MFA" (spec admin-mfa-policy):
 * phiên (`auth/me`), đăng xuất, đổi mật khẩu, và mọi bước bật yếu tố dưới
 * `profile/mfa/`. Liệt kê đủ từng endpoint — không khớp tiền tố, để
 * `profile/mfa/../../users` không bao giờ "nằm dưới" `profile/mfa/`.
 * `tests/admin-mfa-enforcement-behavior.test.ts` đọc thư mục `profile/mfa/` và đỏ
 * khi một endpoint mới ở đó chưa có tên ở đây.
 */
export const MFA_ENROLLMENT_PATHS: ReadonlySet<string> = new Set([
  '/api/admin/auth/me',
  '/api/admin/auth/logout',
  '/api/admin/profile/password',
  '/api/admin/profile/mfa',
  '/api/admin/profile/mfa/enroll',
  '/api/admin/profile/mfa/confirm',
  '/api/admin/profile/mfa/disable',
  '/api/admin/profile/mfa/recovery-codes',
])

/** Chỉ qua khi MỌI dạng đã giải mã đều đúng một endpoint trong danh sách (fail closed). */
export function isMfaEnrollmentPath(routedPath: string, rawPathname: string): boolean {
  const { decodedForms, carriesHash } = pathForms(routedPath, rawPathname)
  return !carriesHash && decodedForms.every(form => MFA_ENROLLMENT_PATHS.has(form))
}

// Server middleware: bảo vệ tất cả /api/admin/** routes
export default defineEventHandler(async (event) => {
  const url = stripQuery(event.path || '/')
  const { isAdmin, isExempt } = classifyAdminRequest(event.path || '/', getRequestURL(event).pathname)

  // Chỉ kiểm tra route /api/admin/** và bỏ qua các endpoint của chính luồng đăng nhập.
  if (!isAdmin || isExempt) return

  // Đọc JWT từ httpOnly cookie
  const token = getCookie(event, 'cdkt_admin')
  if (!token) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized: No token' })
  }

  const payload = verifyToken(token)
  if (!payload) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized: Invalid token' })
  }

  // Vé thử thách MFA được ký bằng cùng khoá với token phiên, nên chữ ký hợp lệ là
  // chưa đủ: phải đúng stage. Không có chốt này thì một vé "mật khẩu đúng, chưa
  // qua yếu tố hai" sẽ mở được toàn bộ /api/admin/**, tức là bỏ hẳn yếu tố hai.
  // Token cũ mint trước khi có claim này không mang stage → coi là phiên.
  if (!isSessionStage(payload)) {
    logWarn({
      event: SECURITY_EVENTS.mfaChallengeFailed,
      userId: payload.userId,
      username: payload.username,
      reason: 'challenge_token_used_as_session',
      path: url,
    })
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized: Invalid token' })
  }

  // Load user + role + permissions từ DB
  const db = getDb()
  const [user] = await db
    .select({
      id:       users.id,
      username: users.username,
      // Trang profile cần email thật; trước đây middleware không select cột này
      // nên `me.get.ts` trả về undefined.
      email:    users.email,
      isActive: users.isActive,
      roleId:   users.roleId,
      roleName: roles.name,
      isSystem: roles.isSystem,
      tokenVersion: users.tokenVersion,
    })
    .from(users)
    .leftJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.id, payload.userId))
    .limit(1)

  if (!user || !user.isActive) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized: User inactive or not found' })
  }

  // Reject sessions minted before the user's last logout / password change.
  // Tokens issued before this field existed carry no version and are treated as
  // generation 0, matching the column default.
  if ((payload.tokenVersion ?? 0) !== (user.tokenVersion ?? 0)) {
    logWarn({ event: SECURITY_EVENTS.sessionRevoked, userId: payload.userId, username: payload.username })
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized: Session revoked' })
  }

  const userPermissions = await db
    .select()
    .from(permissions)
    .where(eq(permissions.roleId, user.roleId!))

  // Attach vào event context
  const adminUser = {
    ...user,
    permissions: userPermissions,
    isSuperAdmin: user.isSystem === true,
  }
  event.context.adminUser = adminUser

  // Chính sách bắt buộc MFA (server/utils/mfa/policy.ts). Tính sau khi đã có quyền
  // từ CSDL — diện "đặc quyền" suy từ chính các cờ đó. `auth/me` đọc lại kết quả
  // này để báo giao diện, không tính lần hai.
  const enrollment = await resolveMfaEnrollment({
    id: user.id,
    tokenVersion: user.tokenVersion,
    isSuperAdmin: adminUser.isSuperAdmin,
    permissions: userPermissions,
  })
  event.context.mfaEnrollment = enrollment
  if (enrollment.enforced && !isMfaEnrollmentPath(event.path || '/', getRequestURL(event).pathname)) {
    throw createError({
      statusCode: 403,
      statusMessage: MFA_ENROLLMENT_REQUIRED_MESSAGE,
      data: { code: MFA_ENROLLMENT_REQUIRED_CODE, message: MFA_ENROLLMENT_REQUIRED_MESSAGE },
    })
  }
})
