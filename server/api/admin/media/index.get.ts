import { finitePositive, MAX_PAGE } from '../../../utils/query-number'
import { getDb } from '../../../utils/db'
import { media, users } from '../../../db/schema'
import { likeContains } from '../../../utils/like-pattern'
import { eq, like, desc, sql, count } from 'drizzle-orm'
import { requireResourcePermission } from '../../../utils/permissions'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'media', 'read')

  const query = getQuery(event)
  const page = finitePositive(query.page, 1, MAX_PAGE)
  // finitePositive before the floor of 10 (FINDING-R7-8: `?perPage=abc` was LIMIT NaN, a 500).
  const perPage = Math.max(10, finitePositive(query.perPage || 30, 30, 100))
  const offset = (page - 1) * perPage
  const search = String(query.search || '').trim()
  const mimeFilter = String(query.type || '').trim() // image | video

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

  return {
    ok: true,
    items,
    pagination: {
      page,
      perPage,
      total: Number(total),
      totalPages: Math.ceil(Number(total) / perPage)
    }
  }
})
