import { getDb } from '../../utils/db'
import { reportPublicReadFailure } from '../../utils/public-read-failure'
import { contentTypes } from '../../db/schema'
import { asc } from 'drizzle-orm'

// Public, unauthenticated content-type listing.
// Flat list ordered by displayOrder then id.
// A failed query answers 503 `{ ok: false, items: [] }` and is logged — it must
// not read as "there are no content types".
export default defineEventHandler(async (event) => {
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
  } catch (error) {
    reportPublicReadFailure(event, 'public.content_types_failed', error)
    return { ok: false, items: [] }
  }
})
