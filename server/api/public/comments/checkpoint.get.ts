import { inArray } from 'drizzle-orm'
import { getDb } from '../../../utils/db'
import { articleComments } from '../../../db/schema'

/**
 * Public comment moderation checkpoint.
 *
 * Allows clients to verify whether recently posted comments were subsequently
 * hidden or revoked by background AI moderation, enabling real-time removal
 * from the rendered thread without a full page reload.
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const rawIds = String(query.ids || '').trim()
  if (!rawIds) return { ok: true, items: [] }

  const ids = rawIds
    .split(',')
    .map(Number)
    .filter((n) => Number.isSafeInteger(n) && n > 0)
    .slice(0, 50)

  if (ids.length === 0) return { ok: true, items: [] }

  const db = getDb()
  const rows = await db
    .select({
      id: articleComments.id,
      isHidden: articleComments.isHidden,
      flagReason: articleComments.flagReason,
    })
    .from(articleComments)
    .where(inArray(articleComments.id, ids))

  return {
    ok: true,
    items: rows,
  }
})
