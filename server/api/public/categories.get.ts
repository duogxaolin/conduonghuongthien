import { getDb } from '../../utils/db'
import { categories } from '../../db/schema'
import { eq, asc } from 'drizzle-orm'

// Public, unauthenticated category listing filtered by `type`.
// Flat list with parentId; ordered by displayOrder then id.
// Returns { ok: true, items: [] } (not an error) when a type has no categories.
export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    const type = String(query.type || '').trim()

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

    return { ok: true, items: rows }
  } catch {
    return { ok: false, items: [] }
  }
})
