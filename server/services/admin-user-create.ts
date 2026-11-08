/**
 * `POST /api/admin/users` — its write, moved out of the handler verbatim. Input checks, the
 * password policy, the target-role guards and the duplicate / 500 mapping of a failure stay
 * in the handler (the call is inside its try/catch, as the transaction was).
 */
import { getDb } from '../utils/db'
import { activityLogs, users } from '../db/schema'

/** Insert the account and its audit row in one transaction; returns the new id. */
export async function createUserWithAudit(
  adminUser: { id: number },
  fields: { username: string, email: string | null, passwordHash: string, roleId: number },
) {
  const { username, email, passwordHash, roleId } = fields
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
  const newUserId = await db.transaction(async (tx) => {
    const [result] = await tx.insert(users).values({
      username,
      email,
      passwordHash,
      roleId,
      isActive: true,
    })

    const created = result.insertId

    await tx.insert(activityLogs).values({
      userId: adminUser.id,
      action: 'create',
      resource: 'users',
      resourceId: created,
      meta: { username, roleId },
    })

    return created
  })

  return newUserId
}
