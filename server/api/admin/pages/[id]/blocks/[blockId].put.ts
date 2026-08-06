import { getDb } from '../../../../../utils/db'
import { pageBlocks, activityLogs } from '../../../../../db/schema'
import { sanitizeBlockData } from '../../../../../utils/sanitize-html'
import { and, eq } from 'drizzle-orm'
import { requireResourcePermission } from '../../../../../utils/permissions'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'pages', 'update')

  const pageId = Number(getRouterParam(event, 'id'))
  const blockId = Number(getRouterParam(event, 'blockId'))
  if (!pageId || !blockId) throw createError({ statusCode: 400, statusMessage: 'Invalid ID' })

  const db = getDb()
  const [existing] = await db
    .select()
    .from(pageBlocks)
    .where(and(eq(pageBlocks.id, blockId), eq(pageBlocks.pageId, pageId)))
    .limit(1)
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Block không tồn tại.' })
  }

  const body = await readBody(event).catch(() => ({}))
  const updateFields: any = {}

  if (body.data !== undefined) {
    if (typeof body.data !== 'object' || body.data === null) {
      throw createError({ statusCode: 400, statusMessage: 'Dữ liệu block không hợp lệ.' })
    }
    // Sanitize rich-text fields — block data is rendered with v-html publicly.
    updateFields.data = sanitizeBlockData(body.data)
  }
  if (body.isVisible !== undefined) updateFields.isVisible = !!body.isVisible

  if (Object.keys(updateFields).length === 0) {
    return { ok: true }
  }

  updateFields.updatedBy = adminUser.id
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
    await tx.update(pageBlocks).set(updateFields).where(eq(pageBlocks.id, blockId))

    await tx.insert(activityLogs).values({
      userId: adminUser.id,
      action: 'update',
      resource: 'pages',
      meta: { pageId, blockId, fields: Object.keys(updateFields) },
    })
  })

  const [block] = await db.select().from(pageBlocks).where(eq(pageBlocks.id, blockId)).limit(1)
  return { ok: true, block }
})
