/**
 * Break-glass: clear another administrator's second factors.
 *
 * SuperAdmin only — deliberately not `users.update`, because this is the one
 * action that can undo another account's authentication hardening, and an editor
 * who can edit users should not be able to strip a colleague's MFA.
 *
 * It exists because voluntary enrollment plus optional recovery codes makes
 * lockout possible, and an unreachable admin account on a public-facing portal is
 * worse than the residual risk of a loud, logged override.
 */
import { getRequestIP } from 'h3'
import { eq } from 'drizzle-orm'
import { getDb } from '../../../../utils/db'
import { users, roles, userMfaFactors, userRecoveryCodes, activityLogs } from '../../../../db/schema'
import { logWarn, SECURITY_EVENTS } from '../../../../utils/logger'
import { revokeSessions } from '../../../../utils/mfa/factors'

export default defineEventHandler(async (event) => {
  const admin = event.context.adminUser
  if (!admin) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  if (admin.isSuperAdmin !== true) {
    throw createError({ statusCode: 403, statusMessage: 'Chỉ quản trị viên cấp cao được xoá xác thực hai bước của tài khoản khác.' })
  }

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid user ID' })

  const db = getDb()
  const [target] = await db
    .select({ id: users.id, username: users.username, roleName: roles.name })
    .from(users)
    .leftJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.id, id))
    .limit(1)
  if (!target) throw createError({ statusCode: 404, statusMessage: 'Người dùng không tồn tại' })

  await db.delete(userMfaFactors).where(eq(userMfaFactors.userId, id))
  await db.delete(userRecoveryCodes).where(eq(userRecoveryCodes.userId, id))
  // The target's live sessions go too: whoever prompted this cannot be assumed
  // to be the only party holding one.
  await revokeSessions(id)

  const ip = getRequestIP(event, { xForwardedFor: false }) || 'unknown'
  // Two rows: one against the actor, one against the target, so the act is
  // visible from either account's history.
  await db.insert(activityLogs).values([
    {
      userId: admin.id,
      action: 'delete',
      resource: 'user_mfa',
      resourceId: id,
      meta: { targetUsername: target.username, ip },
    },
    {
      userId: id,
      action: 'delete',
      resource: 'user_mfa',
      resourceId: id,
      meta: { clearedBy: admin.username, ip },
    },
  ])
  logWarn({
    event: SECURITY_EVENTS.mfaFactorsCleared,
    userId: admin.id,
    username: admin.username,
    targetUserId: id,
    targetUsername: target.username,
    ip,
  })

  return {
    ok: true,
    message: `Đã xoá toàn bộ xác thực hai bước của tài khoản "${target.username}" và thu hồi các phiên đăng nhập.`,
  }
})
