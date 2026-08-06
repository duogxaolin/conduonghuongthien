import { getDb } from '../../../utils/db'
import { contentTypes } from '../../../db/schema'
import { uniqueContentTypeSlug } from '../../../utils/slug'
import { requireResourcePermission } from '../../../utils/permissions'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'categories', 'create')

  const body = await readBody(event).catch(() => ({}))
  const name = String(body?.name || '').trim()
  const icon = String(body?.icon || '').trim() || null
  const description = String(body?.description || '').trim() || null
  const displayOrder = Number(body?.displayOrder ?? 0)

  if (!name) {
    throw createError({ statusCode: 400, statusMessage: 'Tên thể loại không được để trống.' })
  }

  const db = getDb()

  // Clean, collision-safe slug (underscore-separated to match system type keys)
  const rawSlug = String(body?.slug || '').trim()
  const uniqueSlug = await uniqueContentTypeSlug(db, rawSlug || name)

  const [res] = await db.insert(contentTypes).values({
    name,
    slug: uniqueSlug,
    icon,
    description,
    displayOrder,
    isSystem: false,
  })

  return { ok: true, id: res.insertId, slug: uniqueSlug }
})
