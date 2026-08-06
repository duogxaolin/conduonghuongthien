import { getDb } from '../../../utils/db'
import { homeSections, activityLogs } from '../../../db/schema'
import { eq } from 'drizzle-orm'
import { requireResourcePermission } from '../../../utils/permissions'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'home_sections', 'update')

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid section ID' })

  const body = await readBody(event).catch(() => ({}))
  const config = body?.config

  if (!config || typeof config !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Cấu hình section không hợp lệ.' })
  }

  const db = getDb()

  const updateData: any = {
    config,
    updatedAt: new Date(),
    updatedBy: adminUser.id,
  }
  if (body.title) {
    updateData.title = String(body.title)
  }

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
      .set(updateData)
      .where(eq(homeSections.id, id))

    await tx.insert(activityLogs).values({
      userId: adminUser.id,
      action: 'update',
      resource: 'home_sections',
      resourceId: id,
      meta: { config },
    })
  })

  return { ok: true }
})
