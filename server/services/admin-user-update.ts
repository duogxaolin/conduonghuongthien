/**
 * `PUT /api/admin/users/:id` — its queries, moved out of the handler verbatim. Every guard
 * (system account, `assertUserManageable` on the account's CURRENT role, the self-edit
 * refusal, `assertRoleAssignable` / `assertRoleWithinActor` on the target role, the password
 * policy) and the duplicate-email / 500 mapping stay in the handler, in their original order.
 */
import { eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { activityLogs, roles, users } from '../db/schema'

/** The account being edited, with the `is_system` flag of its current role; undefined if absent. */
export async function findUserForEdit(id: number) {
  const db = getDb()
  const [existingUser] = await db
    .select({ id: users.id, username: users.username, roleId: users.roleId, isSystem: roles.isSystem })
    .from(users)
    .leftJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.id, id))
    .limit(1)
  return existingUser
}

/** Apply `updateData` to account `id` and write its audit row, in one transaction. */
export async function updateUserWithAudit(adminUser: { id: number }, id: number, updateData: Partial<typeof users.$inferInsert>) {
  const db = getDb()

  /**
   * Lượt ghi và dòng audit của nó commit cùng nhau, hoặc không cái nào.
   *
   * Viết rời, câu audit có cách hỏng riêng của nó — `activity_logs.user_id`
   * là khoá ngoại tới `users` và `meta` là cột JSON — nên một lượt ghi đã
   * xong có thể còn lại mà không có gì ghi lại ai đã làm. Chạy trên `tx`,
   * không phải `db`: một `db.insert()` đặt trong khối transaction vẫn
   * commit độc lập trên pool.
   */
  await db.transaction(async (tx) => {
    await tx.update(users).set(updateData).where(eq(users.id, id))

    await tx.insert(activityLogs).values({
      userId: adminUser.id,
      action: 'update',
      resource: 'users',
      resourceId: id,
      meta: { fieldsUpdated: Object.keys(updateData) },
    })
  })
}
