/**
 * Chính sách bắt buộc xác thực hai bước cho tài khoản quản trị (spec
 * admin-mfa-policy, design D1).
 *
 *  - `off`        — không bắt buộc ai (mặc định; hành vi trước đây).
 *  - `privileged` — SuperAdmin và mọi tài khoản có quyền sửa/xoá `users`, `roles`
 *                   hoặc `settings` (sao lưu không có tài nguyên riêng: mọi endpoint
 *                   backup đứng sau `settings`, thao tác phá huỷ thêm SuperAdmin —
 *                   nên "quyền sao lưu có tác động" chính là `settings.update`).
 *  - `all`        — mọi tài khoản quản trị.
 *
 * Lưu ở hai khoá `settings` (`mfa_policy`, `mfa_enforce_after`), CHỈ ghi qua
 * `PUT /api/admin/security/mfa-policy` (SuperAdmin, audit cùng transaction —
 * `services/mfa-policy.ts`). Hai khoá này không nằm trong `ALLOWED_SETTING_KEYS`
 * của `settings/index.put.ts` lẫn `SETTINGS_READ_KEYS` của `index.get.ts`.
 *
 * Bật chính sách đặt mốc cưỡng chế 14 ngày sau (`MFA_GRACE_DAYS`). Trong thời hạn
 * đó tài khoản thuộc diện mà chưa có yếu tố nào chỉ được báo ngày; sau mốc, mọi
 * request admin của nó bị 403 `mfa_enrollment_required` trừ các endpoint để bật
 * yếu tố (`admin-auth.ts`, `isMfaEnrollmentPath`). `MFA_ENFORCEMENT=0` (đọc lúc
 * request) tắt hẳn phần cưỡng chế — công tắc khẩn cấp khi một yếu tố hỏng hàng
 * loạt (SMTP chết với email OTP, xoay `JWT_SECRET` làm TOTP vô hiệu).
 *
 * Mọi hàm quyết định ở đây là hàm thuần; phần đọc CSDL có bộ đệm ngắn để chốt
 * `admin-auth` (chạy trên MỌI request admin) không thêm truy vấn mỗi lượt.
 */
import { inArray } from 'drizzle-orm'
import { getDb } from '../db'
import { settings } from '../../db/schema'
import { hasAnyActiveFactor } from './factors'

export const MFA_POLICIES = ['off', 'privileged', 'all'] as const
export type MfaPolicy = typeof MFA_POLICIES[number]
/** 400 cho một giá trị ngoài `MFA_POLICIES` — endpoint (zod) và service nói cùng một câu. */
export const MFA_POLICY_INVALID_MESSAGE = 'Chính sách MFA không hợp lệ (off, privileged hoặc all).'

export const MFA_POLICY_KEY = 'mfa_policy'
export const MFA_ENFORCE_AFTER_KEY = 'mfa_enforce_after'
export const MFA_POLICY_SETTING_KEYS: readonly string[] = Object.freeze([MFA_POLICY_KEY, MFA_ENFORCE_AFTER_KEY])
export const MFA_GRACE_DAYS = 14
const DAY_MS = 24 * 60 * 60 * 1000

/** Mã lỗi riêng trong `data.code` của phản hồi 403 — giao diện dựa vào nó. */
export const MFA_ENROLLMENT_REQUIRED_CODE = 'mfa_enrollment_required'
export const MFA_ENROLLMENT_REQUIRED_MESSAGE
  = 'Tài khoản của bạn phải bật xác thực hai bước trước khi tiếp tục. Vào "Tài khoản của tôi" để bật.'

/** Tài nguyên mà quyền sửa/xoá trên đó làm một tài khoản thành "đặc quyền". */
export const PRIVILEGED_RESOURCES: readonly string[] = Object.freeze(['users', 'roles', 'settings'])

export interface MfaPolicyState {
  policy: MfaPolicy
  /** Mốc cưỡng chế; `null` khi chính sách `off` (hoặc hàng thiếu/hỏng). */
  enforceAfter: Date | null
}

type PermissionLike = { resource: string, canUpdate?: boolean | null, canDelete?: boolean | null }
export interface MfaActor {
  isSuperAdmin?: boolean | null
  permissions?: readonly PermissionLike[] | null
}

export function isMfaPolicy(value: unknown): value is MfaPolicy {
  return typeof value === 'string' && (MFA_POLICIES as readonly string[]).includes(value)
}

/** Giá trị lạ trong CSDL đọc thành `off`: chỉ endpoint SuperAdmin ghi khoá này, và nó kiểm giá trị. */
export function parseMfaPolicy(raw: unknown): MfaPolicy {
  return isMfaPolicy(raw) ? raw : 'off'
}

export function parseEnforceAfter(raw: unknown): Date | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** Mốc cưỡng chế cho một lượt bật/đổi chính sách lúc `now`. `off` không có mốc. */
export function enforcementStartFor(policy: MfaPolicy, now: Date): Date | null {
  return policy === 'off' ? null : new Date(now.getTime() + MFA_GRACE_DAYS * DAY_MS)
}

export function isPrivilegedAccount(actor: MfaActor): boolean {
  if (actor.isSuperAdmin === true) return true
  return (actor.permissions ?? []).some(permission => PRIVILEGED_RESOURCES.includes(permission.resource)
    && (permission.canUpdate === true || permission.canDelete === true))
}

export function isCoveredByMfaPolicy(policy: MfaPolicy, actor: MfaActor): boolean {
  if (policy === 'off') return false
  if (policy === 'all') return true
  return isPrivilegedAccount(actor)
}

/** `MFA_ENFORCEMENT=0|false|off|no` → không cưỡng chế. Đọc mỗi lần gọi (test đổi nó; Nitro không nướng). */
export function mfaEnforcementDisabledByEnv(value: string | undefined = process.env.MFA_ENFORCEMENT): boolean {
  return ['0', 'false', 'off', 'no'].includes(String(value ?? '').trim().toLowerCase())
}

export interface MfaEnrollmentStatus {
  /** Chính sách bao tài khoản này VÀ nó chưa có yếu tố đang hoạt động. */
  needsEnrollment: boolean
  /** Mốc cưỡng chế khi `needsEnrollment`, không thì `null`. */
  enforceAfter: Date | null
  /** Ngay lúc này request ngoài danh sách bật yếu tố bị 403. */
  enforced: boolean
}

export const NO_ENROLLMENT_REQUIRED: MfaEnrollmentStatus = Object.freeze({ needsEnrollment: false, enforceAfter: null, enforced: false })

/** Hàm thuần: trạng thái cưỡng chế của một tài khoản. */
export function decideMfaEnrollment(input: {
  state: MfaPolicyState
  covered: boolean
  hasActiveFactor: boolean
  now: Date
  killSwitch: boolean
}): MfaEnrollmentStatus {
  if (input.state.policy === 'off' || !input.covered || input.hasActiveFactor) return NO_ENROLLMENT_REQUIRED
  const enforceAfter = input.state.enforceAfter
  // Không có mốc (hàng bị sửa tay) → chỉ báo, không cưỡng chế: thiếu dữ liệu không
  // được biến thành khoá người vận hành ở ngoài.
  const enforced = !input.killSwitch && enforceAfter !== null && input.now.getTime() >= enforceAfter.getTime()
  return { needsEnrollment: true, enforceAfter, enforced }
}

/** Hai trường `auth/me` (và phản hồi đăng nhập) báo cho giao diện. */
export function mfaEnrollmentFields(status: MfaEnrollmentStatus): { mfaEnrollmentRequired: boolean, mfaEnforceAfter: string | null } {
  return {
    mfaEnrollmentRequired: status.enforced,
    mfaEnforceAfter: status.needsEnrollment && status.enforceAfter ? status.enforceAfter.toISOString() : null,
  }
}

// ─── Đọc có bộ đệm ────────────────────────────────────────────────────────────

const POLICY_CACHE_MS = 30_000
let policyCache: { at: number, state: MfaPolicyState } | null = null

export async function readMfaPolicy(now: number = Date.now()): Promise<MfaPolicyState> {
  if (policyCache && now - policyCache.at < POLICY_CACHE_MS) return policyCache.state
  const rows = await getDb()
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(inArray(settings.key, [...MFA_POLICY_SETTING_KEYS]))
  const map = new Map(rows.map(row => [row.key, row.value]))
  const policy = parseMfaPolicy(map.get(MFA_POLICY_KEY))
  const state: MfaPolicyState = { policy, enforceAfter: policy === 'off' ? null : parseEnforceAfter(map.get(MFA_ENFORCE_AFTER_KEY)) }
  policyCache = { at: now, state }
  return state
}

/** Gọi sau khi ghi chính sách (cùng tiến trình): lượt request kế tiếp đọc giá trị mới. */
export function clearMfaPolicyCache(): void {
  policyCache = null
}

/**
 * "Tài khoản có yếu tố đang hoạt động" — đệm 60 s theo (user, tokenVersion).
 *
 * Mọi thao tác đổi yếu tố (bật, tắt, SuperAdmin xoá yếu tố) đều tăng `tokenVersion`
 * (`revokeSessions`, `users/[id]/mfa.delete.ts`), nên khoá đệm đổi đúng lúc trạng
 * thái đổi — không có cửa sổ 60 s đọc nhầm.
 */
const FACTOR_CACHE_MS = 60_000
const FACTOR_CACHE_MAX = 500
const factorCache = new Map<string, { at: number, active: boolean }>()

export async function hasActiveFactorCached(userId: number, tokenVersion: number, now: number = Date.now()): Promise<boolean> {
  const key = `${userId}:${tokenVersion}`
  const cached = factorCache.get(key)
  if (cached && now - cached.at < FACTOR_CACHE_MS) return cached.active
  // Cùng định nghĩa "đã bật" với luồng đăng nhập: có một hàng `active`.
  const active = await hasAnyActiveFactor(userId)
  if (factorCache.size >= FACTOR_CACHE_MAX) factorCache.clear()
  factorCache.set(key, { at: now, active })
  return active
}

export function clearMfaFactorCache(): void {
  factorCache.clear()
}

/**
 * Trạng thái cưỡng chế của tài khoản đang đăng nhập. Chính sách `off` hoặc tài
 * khoản ngoài diện → không truy vấn yếu tố.
 */
export async function resolveMfaEnrollment(account: MfaActor & { id: number, tokenVersion?: number | null }, now: Date = new Date()): Promise<MfaEnrollmentStatus> {
  const state = await readMfaPolicy(now.getTime())
  const covered = isCoveredByMfaPolicy(state.policy, account)
  if (!covered) return NO_ENROLLMENT_REQUIRED
  const hasActiveFactor = await hasActiveFactorCached(account.id, account.tokenVersion ?? 0, now.getTime())
  return decideMfaEnrollment({ state, covered, hasActiveFactor, now, killSwitch: mfaEnforcementDisabledByEnv() })
}
