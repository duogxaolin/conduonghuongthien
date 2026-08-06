import { getDb } from '../../utils/db'
import { contentTypes } from '../../db/schema'
import { asc } from 'drizzle-orm'

// Public, unauthenticated content-type listing.
// Flat list ordered by displayOrder then id.
// Returns { ok: true, items: [] } (not an error) on failure.
export default defineEventHandler(async () => {
  try {
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

    return { ok: true, items: rows }
  } catch {
    return { ok: false, items: [] }
  }
})
