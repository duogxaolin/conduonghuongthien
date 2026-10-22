/**
 * Account deletion and activation, shared by the single-row and bulk routes.
 *
 * Three guards protect the deployment from lock-out and take-over, and all must hold
 * per row rather than per request:
 *
 *   - an actor may not delete or deactivate their OWN account
 *   - a system (SuperAdmin) account may not be touched at all
 *   - a non-SuperAdmin may not touch an account whose role holds rights the
 *     actor lacks (`assertUserManageable`)
 *
 * A bulk endpoint that checked only the first row would let an admin select
 * everything and delete the SuperAdmin along the way.
 */
import { createError } from 'h3'
import { eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { activityLogs, permissions, roles, users } from '../db/schema'
import { assertRoleWithinActor, requireResourcePermission, type ActorLike, type RoleGrantRow } from '../utils/permissions'

/** The row plus the facts about its role the guards depend on. */
async function loadTarget(id: number) {
  const db = getDb()
  const [row] = await db
    .select({ id: users.id, username: users.username, roleId: users.roleId, isSystem: roles.isSystem })
    .from(users)
    .leftJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.id, id))
    .limit(1)
  return row
}

/** The permission rows of `roleId` — everything an account in that role can do. */
export async function loadRolePermissions(roleId: number | null | undefined): Promise<RoleGrantRow[]> {
  if (!roleId) return []
  return getDb().select().from(permissions).where(eq(permissions.roleId, roleId))
}

/**
 * 403 unless the actor already holds every right of the account's role.
 *
 * Deleting, locking, re-emailing or re-passwording an account with more rights
 * than yours is taking it over, or taking it away from the people entitled to it;
 * a SuperAdmin is not limited (`assertRoleWithinActor` returns at once).
 */
export async function assertUserManageable(actor: ActorLike, roleId: number | null | undefined): Promise<void> {
  if (actor?.isSuperAdmin === true) return
  assertRoleWithinActor(actor, await loadRolePermissions(roleId), 'Không thể thao tác trên tài khoản có quyền cao hơn quyền của bạn.')
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
  await assertUserManageable(actor, target.roleId)

  const db = getDb()
  // Xoá và dòng audit commit cùng nhau, hoặc không cái nào. Viết rời thì câu
  // audit có cách hỏng riêng của nó — `activity_logs.user_id` là khoá ngoại tới
  // `users`, và `meta` là cột JSON — nên hàng đã mất mà **không còn gì ghi lại
  // ai xoá**. Với một tài khoản quản trị, đó là đúng dấu vết cần giữ nhất.
  // Chạy trên `tx`, không phải `db`: một `db.insert()` đặt trong khối
  // transaction vẫn commit độc lập trên pool.
  await db.transaction(async (tx) => {
    await tx.delete(users).where(eq(users.id, id))
    await tx.insert(activityLogs).values({
      userId: actor.id,
      action: 'delete',
      resource: 'users',
      resourceId: id,
    })
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
  await assertUserManageable(actor, target.roleId)

  const db = getDb()
  await db.transaction(async (tx) => {
    await tx.update(users).set({ isActive }).where(eq(users.id, id))
    await tx.insert(activityLogs).values({
      userId: actor.id,
      action: 'update',
      resource: 'users',
      resourceId: id,
      meta: { isActive },
    })
  })
}
