import { getDb } from '../../../utils/db'
import { media, users } from '../../../db/schema'
import { eq, like, desc, sql, count } from 'drizzle-orm'
import { requireResourcePermission } from '../../../utils/permissions'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'media', 'read')

  const query = getQuery(event)
  const page = Math.max(1, Number(query.page || 1))
  const perPage = Math.min(100, Math.max(10, Number(query.perPage || 30)))
  const offset = (page - 1) * perPage
  const search = String(query.search || '').trim()
  const mimeFilter = String(query.type || '').trim() // image | video

  const db = getDb()

  let conditions = []
  if (search) {
    conditions.push(like(media.originalName, `%${search}%`))
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
    .orderBy(desc(media.createdAt))
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
