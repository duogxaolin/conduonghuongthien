/**
 * Read queries of the admin role endpoints (`roles/index.get.ts`, and the lookup that
 * `roles/[id].put.ts` and `roles/[id].delete.ts` start with), moved out of the handlers
 * verbatim. The audited writes live one per file (`admin-role-create.ts`,
 * `admin-role-update.ts`, `admin-role-delete.ts`): `tests/reader-audit-atomicity.test.ts`
 * checks a transaction and its audit row per FILE, so two audited writes in one file would
 * let either lose its audit row unnoticed.
 */
import { count, eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { permissions, roles, users } from '../db/schema'

/** `GET /api/admin/roles`: every role, every permission row, and how many accounts hold each role. */
export async function listRolesWithGrants() {
  const db = getDb()
  const roleList = await db.select().from(roles)
  const permList = await db.select().from(permissions)
  // How many accounts hold each role — the same rows `[id].delete.ts` refuses on (any
  // `users.role_id`, locked accounts included), so the role editor can grey out "Xóa vai
  // trò" instead of offering a delete that is certain to fail. A count, no identities:
  // listing the accounts stays behind `users.read`. The DELETE still checks for itself.
  const assigned = await db.select({ roleId: users.roleId, total: count() }).from(users).groupBy(users.roleId)

  return { roleList, permList, assigned }
}

/** One role by id, or undefined. */
export async function findRoleById(id: number) {
  const db = getDb()
  const [role] = await db.select().from(roles).where(eq(roles.id, id)).limit(1)
  return role
}
