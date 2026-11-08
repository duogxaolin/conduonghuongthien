/**
 * Queries of the admin taxonomy endpoints — `categories/index.get.ts` and the
 * `content-types` list, create and update routes — moved out of the handlers verbatim:
 * the same statements, in the same order, with no transaction added or removed.
 *
 * The handlers keep everything else: the permission check, reading the body (after the
 * lookup, on the update route, as before), the refusals, and every after-write call
 * (answer-cache bump, i18n auto-translate, public-page purge) in its original place.
 */
import { asc, count, eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { articles, categories, contentTypes } from '../db/schema'
import { uniqueContentTypeSlug } from '../utils/slug'

/** `GET /api/admin/categories`: every category, optionally only those of one type. */
export async function listAdminCategories(typeFilter: string) {
  const db = getDb()

  // Fetch all categories (with optional type filter)
  const all = await db
    .select()
    .from(categories)
    .where(typeFilter ? eq(categories.type, typeFilter) : undefined)
    .orderBy(asc(categories.displayOrder), asc(categories.id))

  return all
}

/** `GET /api/admin/content-types`: every type, plus the category and article counts per slug. */
export async function listContentTypesWithUsage() {
  const db = getDb()

  const all = await db
    .select()
    .from(contentTypes)
    .orderBy(asc(contentTypes.displayOrder), asc(contentTypes.id))

  // Count categories + articles per type (by slug) for the admin usage badges
  const catCounts = await db
    .select({ type: categories.type, c: count() })
    .from(categories)
    .groupBy(categories.type)
  const artCounts = await db
    .select({ type: articles.type, c: count() })
    .from(articles)
    .groupBy(articles.type)

  return { all, catCounts, artCounts }
}

/** One content type by id, or undefined. */
export async function findContentTypeById(id: number) {
  const db = getDb()
  const [existing] = await db.select().from(contentTypes).where(eq(contentTypes.id, id)).limit(1)
  return existing
}

/** The collision-free slug an edit of type `id` would get for `requested`. */
export async function contentTypeSlugForUpdate(requested: string, id: number, isSystem: boolean) {
  const db = getDb()
  return uniqueContentTypeSlug(db, requested, id, isSystem)
}

/**
 * Write the edited fields of type `id`; on a slug rename, move the rows that reference the
 * old slug to the new one.
 *
 * Three UPDATEs and no transaction — exactly as the handler issued them. A failure after the
 * first leaves the rename half-applied (pinned in tests/admin-content-type-writes-behavior.test.ts);
 * changing that is a separate decision, not part of moving the code.
 */
export async function updateContentTypeAndCascadeSlug(
  id: number,
  updateFields: Partial<typeof contentTypes.$inferInsert>,
  existing: { slug: string },
  newSlug: string | null,
) {
  const db = getDb()

  await db.update(contentTypes).set(updateFields).where(eq(contentTypes.id, id))

  // Cascade slug rename to referencing rows so categories/articles stay linked.
  if (newSlug) {
    await db.update(categories).set({ type: newSlug }).where(eq(categories.type, existing.slug))
    await db.update(articles).set({ type: newSlug }).where(eq(articles.type, existing.slug))
  }
}

/** Insert a custom (non-system) type under a collision-free slug derived from `rawSlug` or the name. */
export async function createContentTypeRow(
  rawSlug: string,
  fields: { name: string, icon: string | null, description: string | null, displayOrder: number },
) {
  const { name, icon, description, displayOrder } = fields
  const db = getDb()

  // Clean, collision-safe slug — custom type dùng gạch ngang (isSystem=false).
  const uniqueSlug = await uniqueContentTypeSlug(db, rawSlug || name, undefined, false)

  const [res] = await db.insert(contentTypes).values({
    name,
    slug: uniqueSlug,
    icon,
    description,
    displayOrder,
    isSystem: false,
  })

  return { id: res.insertId, slug: uniqueSlug }
}
