/**
 * `PUT /api/admin/roles/:id` — its write, moved out of the handler verbatim. Every check
 * (system-role rename, SuperAdmin-only grants on a system role, `assertAssignablePermissions`,
 * `assertRoleWithinActor` against the role's CURRENT grants) stays in the handler and runs
 * before this is called, exactly as it did before the transaction.
 */
import { eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { activityLogs, permissions, roles } from '../db/schema'

/**
 * Commit role metadata, grants and audit together. `permValues` undefined = the grants are
 * left alone; an empty array = every grant is removed.
 */
export async function updateRoleWithAudit(
  adminUser: { id: number },
  id: number,
  updateFields: Partial<{ name: string, description: string | null }>,
  permValues: Array<typeof permissions.$inferInsert> | undefined,
) {
  const db = getDb()

  // Validate first, then commit role metadata, grants and audit together.
  await db.transaction(async (tx) => {
    if (Object.keys(updateFields).length > 0) {
      await tx.update(roles).set(updateFields).where(eq(roles.id, id))
    }
    if (permValues !== undefined) {
      await tx.delete(permissions).where(eq(permissions.roleId, id))
      if (permValues.length > 0) await tx.insert(permissions).values(permValues)
    }

    await tx.insert(activityLogs).values({
      userId: adminUser.id,
      action: 'update',
      resource: 'roles',
      resourceId: id,
    })
  })
}
