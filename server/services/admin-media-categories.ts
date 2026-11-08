/**
 * Queries of the Media Portal category routes — `media-portal/categories/index.get.ts`,
 * `index.post.ts`, `[id].put.ts` and `[id].delete.ts` — moved out of the handlers verbatim: the
 * same statements, in the same order, with no transaction added or removed.
 *
 * The handlers keep everything else: the permission checks, reading and normalising the body (on
 * the update route AFTER the lookup, as before), on the update route whether the slug is
 * regenerated and from what, every refusal (400 / 404, the in-use count included) and the
 * response. The create's `rawSlug || name` fallback and display-order floor were part of its
 * statements, so they moved with them.
 *
 * No audit row anywhere here: a media category is portal configuration, not citizen data (see
 * `index.post.ts`; the delete is named in `UNAUDITED_DELETE_EXEMPTIONS`,
 * tests/reader-audit-atomicity.test.ts). Pinned in tests/admin-media-categories-behavior.test.ts.
 */
import { asc, count, eq, isNotNull } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { mediaCategories, mediaItems } from '../db/schema'
import { uniqueMediaCategorySlug } from '../utils/slug'

/** `GET`: every category in display order, and the number of videos per category id. */
export async function listMediaCategoriesWithUsage() {
  const db = getDb()

  // Hai lượt đọc độc lập, chạy cùng lúc: số video dùng từng danh mục không phụ
  // thuộc thứ tự danh sách.
  const [rows, usage] = await Promise.all([
    db
      .select({
        id: mediaCategories.id,
        name: mediaCategories.name,
        slug: mediaCategories.slug,
        description: mediaCategories.description,
        displayOrder: mediaCategories.displayOrder,
        createdAt: mediaCategories.createdAt,
      })
      .from(mediaCategories)
      .orderBy(asc(mediaCategories.displayOrder), asc(mediaCategories.id)),
    db
      .select({ categoryId: mediaItems.categoryId, total: count() })
      .from(mediaItems)
      .where(isNotNull(mediaItems.categoryId)) // loại NULL — đếm video có danh mục
      .groupBy(mediaItems.categoryId),
  ])

  return { rows, usage }
}

/** Insert a category under a collision-free slug derived from `rawSlug` or the name. */
export async function createMediaCategoryRow(
  rawSlug: string,
  fields: { name: string, description: string | null, displayOrder: number },
) {
  const { name, description, displayOrder } = fields
  const db = getDb()

  // Clean, collision-safe slug — dùng `media_categories` (tách khỏi `categories`).
  const uniqueSlug = await uniqueMediaCategorySlug(db, rawSlug || name)

  const [res] = await db.insert(mediaCategories).values({
    name,
    slug: uniqueSlug,
    description,
    displayOrder: Number.isFinite(displayOrder) ? Math.floor(displayOrder) : 0,
  })

  return { id: res.insertId, slug: uniqueSlug }
}

/** One category by id (every column), or undefined. */
export async function findMediaCategoryById(id: number) {
  const db = getDb()
  const [existing] = await db.select().from(mediaCategories).where(eq(mediaCategories.id, id)).limit(1)
  return existing
}

/** The collision-free slug for `base`, not counting category `id` itself (an edit). */
export async function mediaCategorySlugForUpdate(base: string, id: number) {
  const db = getDb()
  return uniqueMediaCategorySlug(db, base, id)
}

/** Write the edited fields of category `id`. */
export async function updateMediaCategoryRow(id: number, updateFields: Partial<typeof mediaCategories.$inferInsert>) {
  const db = getDb()
  await db.update(mediaCategories).set(updateFields).where(eq(mediaCategories.id, id))
}

/** How many videos (`media_items`) are filed under category `id`. */
export async function countMediaItemsInCategory(id: number) {
  const db = getDb()
  const [{ usageCount } = { usageCount: 0 }] = await db
    .select({ usageCount: count() })
    .from(mediaItems)
    .where(eq(mediaItems.categoryId, id))
  return usageCount
}

/**
 * Delete category `id`. The handler refuses first while a video still uses it — a separate
 * statement before this one, not a transaction, exactly as the handler issued them.
 */
export async function deleteMediaCategoryRow(id: number) {
  const db = getDb()
  await db.delete(mediaCategories).where(eq(mediaCategories.id, id))
}
