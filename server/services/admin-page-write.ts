/**
 * Creating a page and editing its settings (`POST /api/admin/pages`, `PUT /api/admin/pages/:id`)
 * — the row write and its audit row, moved out of the handlers verbatim, still in one
 * transaction (2026-11-08: no `server/api` file calls getDb() itself). Reading and checking the
 * body, the slug lock of system pages (home/about/contact), choosing a unique slug
 * (`pickUniquePageSlug`) and the public page cache purge after the commit stay in the handlers.
 */
import { eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { pages, activityLogs } from '../db/schema'

/** index.post: insert the page and its audit row together; the new id. */
export async function createPageWithAudit(adminUser: { id: number }, fields: { slug: string, title: string, seoTitle: string | null, seoDescription: string | null }) {
  const db = getDb()
  const { slug, title, seoTitle, seoDescription } = fields

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
      seoTitle,
      seoDescription,
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
  return insertedId
}

/** [id].put: update the page's title / slug / SEO fields and write its audit row together. */
export async function updatePageWithAudit(
  adminUser: { id: number },
  id: number,
  updateFields: Partial<{ title: string, slug: string, seoTitle: string | null, seoDescription: string | null, updatedBy: number }>,
) {
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
    await tx.update(pages).set(updateFields).where(eq(pages.id, id))

    await tx.insert(activityLogs).values({
      userId: adminUser.id,
      action: 'update',
      resource: 'pages',
      meta: { id, fields: Object.keys(updateFields) },
    })
  })
}
