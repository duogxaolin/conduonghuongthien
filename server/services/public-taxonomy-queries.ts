/**
 * Queries of the public taxonomy listings — `categories.get.ts` and `content-types.get.ts` —
 * moved out of the handlers verbatim. The handlers keep reading the query, the localised
 * category names, the response and `reportPublicReadFailure()` (503 + `no-store`) around
 * these calls.
 */
import { asc, eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { categories, contentTypes } from '../db/schema'

/** Categories of `type` (every category when empty), flat with `parentId`, by display order then id. */
export async function listPublicCategories(type: string) {
  const db = getDb()

  const rows = await db
    .select({
      id:           categories.id,
      name:         categories.name,
      slug:         categories.slug,
      parentId:     categories.parentId,
      type:         categories.type,
      description:  categories.description,
      displayOrder: categories.displayOrder,
    })
    .from(categories)
    .where(type ? eq(categories.type, type) : undefined)
    .orderBy(asc(categories.displayOrder), asc(categories.id))

  return rows
}

/** Every content type, by display order then id. */
export async function listPublicContentTypes() {
  const db = getDb()

  const rows = await db
    .select({
      id:           contentTypes.id,
      name:         contentTypes.name,
      slug:         contentTypes.slug,
      icon:         contentTypes.icon,
      description:  contentTypes.description,
      displayOrder: contentTypes.displayOrder,
    })
    .from(contentTypes)
    .orderBy(asc(contentTypes.displayOrder), asc(contentTypes.id))

  return rows
}
