import { getDb } from '../../../utils/db'
import { contentTypes } from '../../../db/schema'
import { uniqueContentTypeSlug } from '../../../utils/slug'
import { requireResourcePermission } from '../../../utils/permissions'
import { autoTranslateContentType } from '../../../services/i18n-auto-translate'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'categories', 'create')

  const body = await readBody(event).catch(() => ({}))
  const name = String(body?.name || '').trim()
  const icon = String(body?.icon || '').trim() || null
  const description = (() => { const d = String(body?.description || '').trim(); return (!d || d.toLowerCase() === 'null') ? null : d })()
  const displayOrder = Number(body?.displayOrder ?? 0)

  if (!name) {
    throw createError({ statusCode: 400, statusMessage: 'Tên thể loại không được để trống.' })
  }

  const db = getDb()

  // Clean, collision-safe slug — custom type dùng gạch ngang (isSystem=false).
  const rawSlug = String(body?.slug || '').trim()
  const uniqueSlug = await uniqueContentTypeSlug(db, rawSlug || name, undefined, false)

  const [res] = await db.insert(contentTypes).values({
    name,
    slug: uniqueSlug,
    icon,
    description,
    displayOrder,
    isSystem: false,
  })

  // Non-blocking i18n auto-translate (vi gốc + AI dịch 5 lang).
  void autoTranslateContentType(adminUser, uniqueSlug, name, description).catch(() => {})

  return { ok: true, id: res.insertId, slug: uniqueSlug }
})
