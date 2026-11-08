/**
 * `POST /api/admin/articles` and `PUT /api/admin/articles/:id` — their database statements,
 * moved out of the handlers verbatim (2026-11-08: no `server/api` file calls getDb() itself).
 *
 * The handlers keep everything else, in the same order as before: the lookup's scope
 * (`articleActionScope` — it throws 403 itself), the 404, `requireResourcePermission`, reading the
 * body, `decodePlainTextInput` / `sanitizeHtml` of every field, the SECOND `checkPermission()` when an
 * edit changes the article's type (CLAUDE.md's one named exception), the slug, and the after-commit
 * `bumpAnswerCacheVersion()` / `purgePublicPageCacheAfterWrite()`. What is written here is exactly the
 * object the handler built — `tests/_translation-writes.ts` follows the payload parameter back to it
 * and proves `content` went through `sanitizeHtml` there.
 */
import { and, eq, type SQL } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { activityLogs, articles } from '../db/schema'

/** The article `id`, if it is inside `scope` (the handler's `articleActionScope(…, ['read', 'update'])`). */
export async function findArticleForUpdate(id: number, scope: SQL) {
  const db = getDb()
  const [existingArticle] = await db.select().from(articles).where(and(eq(articles.id, id), scope)).limit(1)
  return existingArticle
}

/** The update and its audit row (`meta.fieldsUpdated` = the keys the handler set, in its order), in one transaction. */
export async function updateArticleWithAudit(actorId: number, id: number, updateFields: Partial<typeof articles.$inferInsert>) {
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
    await tx.update(articles).set(updateFields).where(eq(articles.id, id))

    await tx.insert(activityLogs).values({
      userId: actorId,
      action: 'update',
      resource: 'articles',
      resourceId: id,
      meta: { fieldsUpdated: Object.keys(updateFields) },
    })
  })
}

/** The row of a new article, as the handler built it (plain-text fields decoded, `content` sanitised). */
export interface NewArticleValues {
  type: string
  category: string | null
  categoryId: number | null
  title: string
  slug: string
  excerpt: string | null
  content: string
  status: string
  thumbnailUrl: string | null
  commentsEnabled: boolean
  authorId: number
  publishedAt: Date | null
}

/** Insert the article and its audit row in one transaction; returns the new id. */
export async function createArticleWithAudit(actorId: number, row: NewArticleValues) {
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
  const newArticleId = await db.transaction(async (tx) => {
    const [res] = await tx.insert(articles).values(row)

    const created = res.insertId

    await tx.insert(activityLogs).values({
      userId: actorId,
      action: 'create',
      resource: 'articles',
      resourceId: created,
      meta: { title: row.title, type: row.type, status: row.status, commentsEnabled: row.commentsEnabled },
    })

    return created
  })

  return newArticleId
}
