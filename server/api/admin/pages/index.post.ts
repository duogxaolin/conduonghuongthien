import { getDb } from '../../../utils/db'
import { pages, activityLogs } from '../../../db/schema'
import { uniquePageSlug } from '../../../utils/slug'
import { requireResourcePermission } from '../../../utils/permissions'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'pages', 'create')

  const body = await readBody(event).catch(() => ({}))
  const title = String(body?.title || '').trim()
  if (!title) {
    throw createError({ statusCode: 400, statusMessage: 'Tiêu đề trang là bắt buộc.' })
  }

  const db = getDb()
  const base = String(body?.slug || title).trim()
  const slug = await uniquePageSlug(db, base)

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
    const [res] = await tx.insert(pages).values({
      slug,
      title,
      isSystem: false,
      seoTitle: body?.seoTitle ? String(body.seoTitle).trim() : null,
      seoDescription: body?.seoDescription ? String(body.seoDescription).trim() : null,
      updatedBy: adminUser.id,
    })

    const created = res.insertId

    await tx.insert(activityLogs).values({
      userId: adminUser.id,
      action: 'create',
      resource: 'pages',
      meta: { slug, title },
    })

    return created
  })

  return { ok: true, id: Number(insertedId), slug }
})
