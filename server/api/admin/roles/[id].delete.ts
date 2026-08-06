import { getDb } from '../../../utils/db'
import { roles, users, activityLogs } from '../../../db/schema'
import { eq } from 'drizzle-orm'
import { requireResourcePermission } from '../../../utils/permissions'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'roles', 'delete')

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid role ID' })

  const db = getDb()
  const [role] = await db.select().from(roles).where(eq(roles.id, id)).limit(1)

  if (!role) {
    throw createError({ statusCode: 404, statusMessage: 'Vai trò không tồn tại.' })
  }
  if (role.isSystem) {
    throw createError({ statusCode: 400, statusMessage: 'Không thể xóa vai trò hệ thống.' })
  }

  // Check if users are assigned to this role
  const usersWithRole = await db.select().from(users).where(eq(users.roleId, id)).limit(1)
  if (usersWithRole.length > 0) {
    throw createError({ statusCode: 400, statusMessage: 'Vẫn còn tài khoản gán cho vai trò này. Hãy gán lại trước khi xóa.' })
  }

  /**
   * The row and its audit line commit together, or neither does.
   *
   * Written unwrapped, the delete lands first and the audit insert can still
   * fail on its own: `activity_logs.user_id` is a foreign key into `users`, and
   * a connection dropped between the two statements is enough. What is left is a
   * deleted permission role with nothing recording who removed it — the exact
   * pairing `tests/reader-audit-atomicity.test.ts` was written to enforce on the
   * reader side, applied here to a role that governs who can do anything at all.
   *
   * The audit insert runs on `tx`, not `db`: a `db.insert()` placed inside a
   * transaction block still runs on the pool and commits independently, which is
   * the same bug wearing a transaction's clothes.
   */
  await db.transaction(async (tx) => {
    await tx.delete(roles).where(eq(roles.id, id))

    await tx.insert(activityLogs).values({
      userId: adminUser.id,
      action: 'delete',
      resource: 'roles',
      resourceId: id,
    })
  })

  return { ok: true }
})
