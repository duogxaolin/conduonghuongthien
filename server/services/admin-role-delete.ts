/**
 * `DELETE /api/admin/roles/:id` — its queries, moved out of the handler verbatim. The
 * permission check, the 404 / system-role / still-assigned refusals and the response stay
 * in the handler; this file holds the statements, in the order the handler ran them.
 */
import { eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { activityLogs, roles, users } from '../db/schema'

/** Accounts assigned to role `id` — at most one row: the handler only asks whether any exist. */
export async function findUsersWithRole(id: number) {
  const db = getDb()
  // Check if users are assigned to this role
  const usersWithRole = await db.select().from(users).where(eq(users.roleId, id)).limit(1)
  return usersWithRole
}

/** Delete role `id` and write its audit row, in one transaction. */
export async function deleteRoleWithAudit(adminUser: { id: number }, id: number) {
  const db = getDb()

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
}
