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

import { eq, sql } from 'drizzle-orm'
import { getDb } from '../../../../utils/db'
import { users, roles, userMfaFactors, userRecoveryCodes, activityLogs } from '../../../../db/schema'
import { logWarn, SECURITY_EVENTS } from '../../../../utils/logger'
import { getClientIp } from '../../../../utils/client-ip'

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

  const ip = getClientIp(event)

  /**
   * Four writes, one commit.
   *
   * This is the single action that can undo another administrator's
   * authentication hardening, so a partial application is the worst possible
   * outcome: factors cleared but sessions still live, or — the case that matters
   * most — every trace of the override removed while the override itself stands.
   * `activity_logs.user_id` is a foreign key and `meta` is JSON, so the audit
   * insert has its own ways to fail independently of the deletes above it.
   *
   * `revokeSessions()` is not called here because it opens its own `getDb()`
   * handle and so cannot join this transaction; its one statement is inlined on
   * `tx` instead. Everything runs on `tx` rather than `db` — a `db.insert()`
   * sitting inside a transaction block still commits on the pool independently,
   * which is this same bug wearing a transaction's clothes.
   */
  await db.transaction(async (tx) => {
    await tx.delete(userMfaFactors).where(eq(userMfaFactors.userId, id))
    await tx.delete(userRecoveryCodes).where(eq(userRecoveryCodes.userId, id))
    // The target's live sessions go too: whoever prompted this cannot be assumed
    // to be the only party holding one.
    await tx
      .update(users)
      .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.id, id))

    // Two rows: one against the actor, one against the target, so the act is
    // visible from either account's history.
    await tx.insert(activityLogs).values([
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
  })

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
