/**
 * Reads of the Media Library routes — the page of files (`media/index.get.ts`), the per-provider
 * count (`media/counts.get.ts`) and the database half of `media/storage-size.get.ts` — moved out
 * of the handlers verbatim.
 *
 * The handlers keep the permission checks, the query parsing (page, the perPage floor of 10,
 * search, type), the pagination and the response shaping, the disk walk and the R2 listing.
 */
import { count, desc, eq, like, sql } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { media, users } from '../db/schema'
import { likeContains } from '../utils/like-pattern'

/** One page of library files, newest first, with the uploader's username, and the matching total. */
export async function listAdminMediaPage(filters: { search: string, mimeFilter: string, perPage: number, offset: number }) {
  const { search, mimeFilter, perPage, offset } = filters
  const db = getDb()

  const conditions = []
  if (search) {
    // The file name as typed: `_` (common in file names) and `%` are not wildcards (FINDING-R7-7).
    conditions.push(like(media.originalName, likeContains(search)))
  }
  if (mimeFilter === 'image') {
    conditions.push(like(media.mimeType, 'image/%'))
  } else if (mimeFilter === 'video') {
    conditions.push(like(media.mimeType, 'video/%'))
  }

  const whereClause = conditions.length > 0 ? sql`${sql.join(conditions, sql` AND `)}` : undefined

  const items = await db
    .select({
      id:           media.id,
      filename:     media.filename,
      originalName: media.originalName,
      mimeType:     media.mimeType,
      sizeBytes:    media.sizeBytes,
      provider:     media.provider,
      url:          media.url,
      width:        media.width,
      height:       media.height,
      createdAt:    media.createdAt,
      uploadedBy:   users.username,
    })
    .from(media)
    .leftJoin(users, eq(media.uploadedBy, users.id))
    .where(whereClause)
    .orderBy(desc(media.createdAt), desc(media.id)) // ties: one bulk upload shares a second (FINDING-R7-9)
    .limit(perPage)
    .offset(offset)

  const [{ total } = { total: 0 }] = await db
    .select({ total: count() })
    .from(media)
    .where(whereClause)

  return { items, total }
}

/** Number of library files per provider (`local` / `r2`). */
export async function countMediaByProvider() {
  const db = getDb()
  const rows = await db
    .select({ provider: media.provider, count: sql<number>`COUNT(*)` })
    .from(media)
    .groupBy(media.provider)
  return rows
}

/** Number and total bytes of library files per provider, as the `media` table records them. */
export async function sumMediaBytesByProvider() {
  const db = getDb()

  // Tổng bytes + count theo provider từ DB.
  const dbRows = await db
    .select({
      provider: media.provider,
      count: sql<number>`COUNT(*)`,
      bytes: sql<number>`COALESCE(SUM(${media.sizeBytes}), 0)`,
    })
    .from(media)
    .groupBy(media.provider)
  return dbRows
}
