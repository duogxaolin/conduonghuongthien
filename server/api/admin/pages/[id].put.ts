import { getDb } from '../../../utils/db'
import { pages, activityLogs } from '../../../db/schema'
import { uniquePageSlug } from '../../../utils/slug'
import { eq } from 'drizzle-orm'
import { requireResourcePermission } from '../../../utils/permissions'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'pages', 'update')

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid page ID' })

  const db = getDb()
  const [existing] = await db.select().from(pages).where(eq(pages.id, id)).limit(1)
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Trang không tồn tại.' })
  }

  const body = await readBody(event).catch(() => ({}))
  const updateFields: any = {}

  if (body.title !== undefined) {
    const title = String(body.title).trim()
    if (!title) throw createError({ statusCode: 400, statusMessage: 'Tiêu đề không được để trống.' })
    updateFields.title = title
  }
  if (body.seoTitle !== undefined) updateFields.seoTitle = String(body.seoTitle).trim() || null
  if (body.seoDescription !== undefined) updateFields.seoDescription = String(body.seoDescription).trim() || null

  // Slug is locked for system pages (home/about/contact). Custom pages may rename.
  if (body.slug !== undefined && !existing.isSystem) {
    const base = String(body.slug).trim() || existing.title
    updateFields.slug = await uniquePageSlug(db, base, id)
  }

  if (Object.keys(updateFields).length === 0) {
    return { ok: true, slug: existing.slug }
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
    await tx.update(pages).set(updateFields).where(eq(pages.id, id))

    await tx.insert(activityLogs).values({
      userId: adminUser.id,
      action: 'update',
      resource: 'pages',
      meta: { id, fields: Object.keys(updateFields) },
    })
  })

  return { ok: true, slug: updateFields.slug ?? existing.slug }
})
