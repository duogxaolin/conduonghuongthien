import { getDb } from '../../../../utils/db'
import { homeSections, activityLogs } from '../../../../db/schema'
import { eq } from 'drizzle-orm'
import { requireResourcePermission } from '../../../../utils/permissions'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'home_sections', 'update')

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid section ID' })

  const db = getDb()
  const [section] = await db.select().from(homeSections).where(eq(homeSections.id, id)).limit(1)

  if (!section) {
    throw createError({ statusCode: 404, statusMessage: 'Section không tồn tại.' })
  }

  const newVisibility = !section.isVisible

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
    await tx.update(homeSections)
      .set({
        isVisible: newVisibility,
        updatedAt: new Date(),
        updatedBy: adminUser.id,
      })
      .where(eq(homeSections.id, id))

    await tx.insert(activityLogs).values({
      userId: adminUser.id,
      action: 'update',
      resource: 'home_sections',
      resourceId: id,
      meta: { isVisible: newVisibility },
    })
  })

  return { ok: true, isVisible: newVisibility }
})
