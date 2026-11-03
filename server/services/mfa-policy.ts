/**
 * Ghi và đọc tổng quan chính sách bắt buộc MFA (spec admin-mfa-policy, design D1).
 * Quyết định thuần + đọc có đệm ở `server/utils/mfa/policy.ts`.
 *
 * Ghi = hai hàng `settings` + một dòng `activity_logs` trong CÙNG transaction
 * (CLAUDE.md "Đường ghi audit"): một lượt đổi chính sách bắt buộc đăng nhập mà
 * không để lại ai đã đổi là đúng thứ nhật ký tồn tại để trả lời.
 */
import { eq } from 'drizzle-orm'
import { createError } from 'h3'
import { getDb } from '../utils/db'
import { activityLogs, permissions, roles, settings, userMfaFactors, users } from '../db/schema'
import { requireResourcePermission, requireSuperAdmin, type ActorLike } from '../utils/permissions'
import {
  MFA_ENFORCE_AFTER_KEY,
  MFA_GRACE_DAYS,
  MFA_POLICY_INVALID_MESSAGE,
  MFA_POLICY_KEY,
  clearMfaFactorCache,
  clearMfaPolicyCache,
  enforcementStartFor,
  isCoveredByMfaPolicy,
  isMfaPolicy,
  mfaEnforcementDisabledByEnv,
  readMfaPolicy,
  type MfaPolicy,
} from '../utils/mfa/policy'

export interface MfaPolicyOverview {
  policy: MfaPolicy
  enforceAfter: string | null
  graceDays: number
  /** `MFA_ENFORCEMENT=0` trên máy chủ: chính sách lưu được nhưng không chặn ai. */
  killSwitch: boolean
  /** Tài khoản đang hoạt động CHƯA có yếu tố nào, theo từng mức chính sách. */
  withoutFactor: Record<Exclude<MfaPolicy, 'off'>, Array<{ id: number, username: string, roleName: string | null }>>
}

export async function getMfaPolicyOverview(actor: ActorLike): Promise<MfaPolicyOverview> {
  requireResourcePermission(actor, 'settings', 'read')
  requireSuperAdmin(actor)

  const db = getDb()
  const state = await readMfaPolicy()
  const accounts = await db
    .select({ id: users.id, username: users.username, isActive: users.isActive, roleId: users.roleId, roleName: roles.name, isSystem: roles.isSystem })
    .from(users)
    .leftJoin(roles, eq(users.roleId, roles.id))
  const grants = await db.select().from(permissions)
  const activeFactors = await db
    .select({ userId: userMfaFactors.userId })
    .from(userMfaFactors)
    .where(eq(userMfaFactors.state, 'active'))
  const enrolled = new Set(activeFactors.map(row => row.userId))

  const withoutFactor: MfaPolicyOverview['withoutFactor'] = { privileged: [], all: [] }
  for (const account of accounts) {
    if (account.isActive === false || enrolled.has(account.id)) continue
    const subject = {
      isSuperAdmin: account.isSystem === true,
      permissions: grants.filter(grant => grant.roleId === account.roleId),
    }
    const row = { id: account.id, username: account.username, roleName: account.roleName ?? null }
    if (isCoveredByMfaPolicy('privileged', subject)) withoutFactor.privileged.push(row)
    if (isCoveredByMfaPolicy('all', subject)) withoutFactor.all.push(row)
  }

  return {
    policy: state.policy,
    enforceAfter: state.enforceAfter ? state.enforceAfter.toISOString() : null,
    graceDays: MFA_GRACE_DAYS,
    killSwitch: mfaEnforcementDisabledByEnv(),
    withoutFactor,
  }
}

/**
 * Đặt chính sách. Mỗi lượt ĐỔI ghi mốc cưỡng chế mới = bây giờ + 14 ngày (`off` xoá
 * mốc). Gửi lại đúng giá trị đang có → không ghi gì, không làm lùi mốc đang chạy.
 */
export async function setMfaPolicy(actor: ActorLike & { id?: number }, input: unknown, now: Date = new Date()): Promise<{ policy: MfaPolicy, enforceAfter: string | null, changed: boolean }> {
  requireResourcePermission(actor, 'settings', 'update')
  requireSuperAdmin(actor)

  if (!isMfaPolicy(input)) {
    throw createError({ statusCode: 400, statusMessage: MFA_POLICY_INVALID_MESSAGE })
  }
  const next = input

  const db = getDb()
  // Đọc thẳng (không qua đệm): so với giá trị đang lưu thật.
  const rows = await db.select({ key: settings.key, value: settings.value }).from(settings).where(eq(settings.key, MFA_POLICY_KEY))
  const stored = rows.find(row => row.key === MFA_POLICY_KEY)?.value
  const previous: MfaPolicy = isMfaPolicy(stored) ? stored : 'off'
  if (previous === next) {
    // Không ghi gì, nhưng bỏ đệm: lượt lưu lại là cách áp ngay một giá trị đã sửa tay.
    clearMfaPolicyCache()
    const state = await readMfaPolicy()
    return { policy: next, enforceAfter: state.enforceAfter ? state.enforceAfter.toISOString() : null, changed: false }
  }

  const start = enforcementStartFor(next, now)
  const enforceAfter = start ? start.toISOString() : ''

  await db.transaction(async (tx) => {
    await tx.insert(settings).values({ key: MFA_POLICY_KEY, value: next, group: 'security' })
      .onDuplicateKeyUpdate({ set: { value: next } })
    await tx.insert(settings).values({ key: MFA_ENFORCE_AFTER_KEY, value: enforceAfter, group: 'security' })
      .onDuplicateKeyUpdate({ set: { value: enforceAfter } })
    await tx.insert(activityLogs).values({
      userId: actor.id,
      action: 'update',
      resource: 'settings',
      meta: { settingsGroup: 'security', mfaPolicy: { from: previous, to: next }, enforceAfter: enforceAfter || null },
    })
  })

  // Sau commit: lượt request kế tiếp của tiến trình này đọc chính sách mới.
  clearMfaPolicyCache()
  clearMfaFactorCache()
  return { policy: next, enforceAfter: enforceAfter || null, changed: true }
}
