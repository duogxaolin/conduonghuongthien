/**
 * Read queries of the admin account endpoints (`users/index.get.ts`, and the target-role
 * lookup that `users/index.post.ts` and `users/[id].put.ts` make), moved out of the handlers
 * verbatim. The audited writes live one per file (`admin-user-create.ts`,
 * `admin-user-update.ts`, `admin-user-mfa-reset.ts`): `tests/reader-audit-atomicity.test.ts`
 * checks a transaction and its audit row per FILE.
 */
import { desc, eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { roles, users } from '../db/schema'

/** `GET /api/admin/users`: every account with its role name, newest first. */
export async function listAdminUsers() {
  const db = getDb()

  const userList = await db
    .select({
      id:          users.id,
      username:    users.username,
      email:       users.email,
      isActive:    users.isActive,
      roleId:      users.roleId,
      roleName:    roles.name,
      createdAt:   users.createdAt,
      lastLoginAt: users.lastLoginAt,
    })
    .from(users)
    .leftJoin(roles, eq(users.roleId, roles.id))
    .orderBy(desc(users.createdAt))

  return userList
}

/** `{ isSystem }` of role `roleId`, or undefined when there is no such role. */
export async function findRoleSystemFlag(roleId: number) {
  const db = getDb()
  const [targetRole] = await db.select({ isSystem: roles.isSystem }).from(roles).where(eq(roles.id, roleId)).limit(1)
  return targetRole
}
