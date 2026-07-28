/**
 * Account deletion and activation, shared by the single-row and bulk routes.
 *
 * Two guards protect the deployment from locking itself out, and both must hold
 * per row rather than per request:
 *
 *   - an actor may not delete or deactivate their OWN account
 *   - a system (SuperAdmin) account may not be touched at all
 *
 * A bulk endpoint that checked only the first row would let an admin select
 * everything and delete the SuperAdmin along the way.
 */
import { createError } from 'h3'
import { eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { activityLogs, roles, users } from '../db/schema'
import { requireResourcePermission, type ActorLike } from '../utils/permissions'

/** The row plus the one fact about its role the guards depend on. */
async function loadTarget(id: number) {
  const db = getDb()
  const [row] = await db
    .select({ id: users.id, username: users.username, isSystem: roles.isSystem })
    .from(users)
    .leftJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.id, id))
    .limit(1)
  return row
}

function assertNotSelf(actor: ActorLike, id: number, action: 'xóa' | 'thay đổi trạng thái') {
  if (actor.id === id) {
    throw createError({ statusCode: 400, statusMessage: `Không thể ${action} chính tài khoản của bạn.` })
  }
}

export async function deleteUserById(actor: ActorLike, id: number): Promise<void> {
  requireResourcePermission(actor, 'users', 'delete')
  assertNotSelf(actor, id, 'xóa')

  const target = await loadTarget(id)
  if (!target) throw createError({ statusCode: 404, statusMessage: 'Người dùng không tồn tại' })
  if (target.isSystem) {
    throw createError({ statusCode: 403, statusMessage: 'Không thể xóa tài khoản hệ thống SuperAdmin.' })
  }

  const db = getDb()
  await db.delete(users).where(eq(users.id, id))
  await db.insert(activityLogs).values({
    userId: actor.id,
    action: 'delete',
    resource: 'users',
    resourceId: id,
  })
}

/**
 * Lock or unlock an account. This is what "hide" means for a user: the
 * admin-auth middleware re-reads `isActive` on every request, so a locked
 * account loses access immediately — no session invalidation needed.
 */
export async function setUserActive(actor: ActorLike, id: number, isActive: boolean): Promise<void> {
  requireResourcePermission(actor, 'users', 'update')
  // Locking yourself out is not recoverable from the UI, so it is refused even
  // though the single-row toggle never offered it.
  if (!isActive) assertNotSelf(actor, id, 'thay đổi trạng thái')

  const target = await loadTarget(id)
  if (!target) throw createError({ statusCode: 404, statusMessage: 'Người dùng không tồn tại' })
  if (target.isSystem) {
    throw createError({ statusCode: 403, statusMessage: 'Không thể sửa tài khoản hệ thống SuperAdmin.' })
  }

  const db = getDb()
  await db.update(users).set({ isActive }).where(eq(users.id, id))
  await db.insert(activityLogs).values({
    userId: actor.id,
    action: 'update',
    resource: 'users',
    resourceId: id,
    meta: { isActive },
  })
}
