/**
 * Submission deletion.
 *
 * This resource had no delete route at all before — the admin list was read-only,
 * so the only way to clear a spam run was through the database. The single-row
 * and bulk routes are both new and both go through here.
 *
 * A submission is a citizen's contact record (name, phone, address). Two
 * consequences: deletion is genuinely irreversible, and the audit entry records
 * only the id, because copying the personal details into `activity_logs` would
 * defeat the deletion by leaving the same data behind in another table.
 */
import { createError } from 'h3'
import { eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { activityLogs, submissions } from '../db/schema'
import { requireResourcePermission, type ActorLike } from '../utils/permissions'

export async function deleteSubmissionById(actor: ActorLike, id: number): Promise<void> {
  requireResourcePermission(actor, 'submissions', 'delete')

  const db = getDb()
  const [existing] = await db.select({ id: submissions.id }).from(submissions).where(eq(submissions.id, id)).limit(1)
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Đơn đăng ký không tồn tại.' })

  // Cùng transaction. Đây là hồ sơ liên hệ của một công dân và lượt xoá là
  // **không đảo được**, nên dòng audit là thứ duy nhất còn lại sau đó; để nó ghi
  // rời là để mất chính bằng chứng về việc xoá. Chạy trên `tx`, không phải `db`:
  // một `db.insert()` trong khối transaction vẫn commit độc lập trên pool.
  await db.transaction(async (tx) => {
    await tx.delete(submissions).where(eq(submissions.id, id))
    await tx.insert(activityLogs).values({
      userId: actor.id,
      action: 'delete',
      resource: 'submissions',
      resourceId: id,
    })
  })
}
