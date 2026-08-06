import { getDb } from '../../../../../utils/db'
import { pages, pageBlocks, activityLogs } from '../../../../../db/schema'
import { isValidBlockType, getDefaultData } from '../../../../../../app/utils/blocks/registry'
import { sanitizeBlockData } from '../../../../../utils/sanitize-html'
import { eq, sql } from 'drizzle-orm'
import { requireResourcePermission } from '../../../../../utils/permissions'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'pages', 'create')

  const pageId = Number(getRouterParam(event, 'id'))
  if (!pageId) throw createError({ statusCode: 400, statusMessage: 'Invalid page ID' })

  const body = await readBody(event).catch(() => ({}))
  const blockType = String(body?.blockType || '').trim()
  if (!isValidBlockType(blockType)) {
    throw createError({ statusCode: 400, statusMessage: 'Loại block không hợp lệ.' })
  }

  const db = getDb()
  const [page] = await db.select().from(pages).where(eq(pages.id, pageId)).limit(1)
  if (!page) {
    throw createError({ statusCode: 404, statusMessage: 'Trang không tồn tại.' })
  }

  // Next display order = current max + 1
  const [{ maxOrder } = { maxOrder: 0 }] = await db
    .select({ maxOrder: sql<number>`coalesce(max(${pageBlocks.displayOrder}), 0)` })
    .from(pageBlocks)
    .where(eq(pageBlocks.pageId, pageId))

  // Sanitize rich-text fields — block data is rendered with v-html publicly.
  const data = sanitizeBlockData(body?.data && typeof body.data === 'object' ? body.data : getDefaultData(blockType))

  /**
   * Lượt ghi và dòng audit của nó commit cùng nhau, hoặc không cái nào.
   *
   * Viết rời, câu audit có cách hỏng riêng của nó — `activity_logs.user_id`
   * là khoá ngoại tới `users` và `meta` là cột JSON — nên một lượt ghi đã
   * xong có thể còn lại mà không có gì ghi lại ai đã làm. Chạy trên `tx`,
   * không phải `db`: một `db.insert()` đặt trong khối transaction vẫn
   * commit độc lập trên pool.
   */
  const insertedId = await db.transaction(async (tx) => {
    const [res] = await tx.insert(pageBlocks).values({
      pageId,
      blockType,
      displayOrder: Number(maxOrder) + 1,
      data,
      isVisible: true,
      updatedBy: adminUser.id,
    })

    const created = res.insertId

    await tx.insert(activityLogs).values({
      userId: adminUser.id,
      action: 'create',
      resource: 'pages',
      meta: { pageId, blockId: Number(insertedId), blockType },
    })

    return created
  })

  const [block] = await db.select().from(pageBlocks).where(eq(pageBlocks.id, Number(insertedId))).limit(1)
  return { ok: true, block }
})
