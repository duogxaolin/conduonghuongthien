/**
 * `POST /api/admin/roles` — its write, moved out of the handler verbatim. Input checks,
 * `assertAssignablePermissions` and the duplicate-name / 500 mapping of a failure stay in
 * the handler (the call is inside its try/catch, as the transaction was).
 */
import { getDb } from '../utils/db'
import { activityLogs, permissions, roles } from '../db/schema'
import type { PermissionGrant } from '../../shared/permissions'

/** Insert the role, its grants and its audit row in one transaction; returns the new id. */
export async function createRoleWithAudit(
  adminUser: { id: number },
  fields: { name: string, description: string | null, permsInput: PermissionGrant[] },
) {
  const { name, description, permsInput } = fields
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
  const newRoleId = await db.transaction(async (tx) => {
    const [res] = await tx.insert(roles).values({
      name,
      description,
      isSystem: false,
    })

    const created = res.insertId

    if (permsInput.length > 0) {
      // Reject invalid resources and block granting permissions the actor lacks.
      const permValues = permsInput.map(p => ({ ...p, roleId: created }))
      await tx.insert(permissions).values(permValues)
    }

    await tx.insert(activityLogs).values({
      userId: adminUser.id,
      action: 'create',
      resource: 'roles',
      resourceId: created,
      meta: { name },
    })

    return created
  })

  return newRoleId
}
