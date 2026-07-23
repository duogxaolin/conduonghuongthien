import { getDb } from '../../../utils/db'
import { contentTypes } from '../../../db/schema'
import { checkPermission } from '../../../utils/auth'
import { uniqueContentTypeSlug } from '../../../utils/slug'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  if (!checkPermission(adminUser.permissions, 'categories', 'create', adminUser.isSuperAdmin)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }

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
