import { getDb } from '../../../utils/db'
import { categories } from '../../../db/schema'
import { uniqueCategorySlug } from '../../../utils/slug'
import { eq } from 'drizzle-orm'
import { requireResourcePermission } from '../../../utils/permissions'
import { autoTranslateCategory } from '../../../services/i18n-auto-translate'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'categories', 'create')

  const body = await readBody(event).catch(() => ({}))
  const name = String(body?.name || '').trim()
  const type = String(body?.type || '').trim()
  const description = (() => { const d = String(body?.description || '').trim(); return (!d || d.toLowerCase() === 'null') ? null : d })()
  const displayOrder = Number(body?.displayOrder ?? 0)
  const parentId = body?.parentId ? Number(body.parentId) : null

  if (!name) {
    throw createError({ statusCode: 400, statusMessage: 'Tên danh mục không được để trống.' })
  }
  if (!type) {
    throw createError({ statusCode: 400, statusMessage: 'Loại danh mục không được để trống.' })
  }

  const db = getDb()

  // Validate parentId: parent must exist and be a root category
  if (parentId) {
    const [parent] = await db.select().from(categories).where(eq(categories.id, parentId)).limit(1)
    if (!parent) {
      throw createError({ statusCode: 400, statusMessage: 'Danh mục cha không tồn tại.' })
    }
    if (parent.parentId !== null) {
      throw createError({ statusCode: 400, statusMessage: 'Chỉ cho phép 1 cấp cha-con. Không thể chọn danh mục con làm cha.' })
    }
  }

  // Clean, collision-safe slug: derived from provided slug or name, deduped by -2, -3, …
  const rawSlug = String(body?.slug || '').trim()
  const uniqueSlug = await uniqueCategorySlug(db, rawSlug || name)

  const [res] = await db.insert(categories).values({
    name,
    slug: uniqueSlug,
    parentId,
    type,
    description,
    displayOrder,
  })

  // Non-blocking i18n auto-translate (vi gốc + AI dịch 5 lang).
  void autoTranslateCategory(adminUser, uniqueSlug, name, description).catch(() => {})

  return { ok: true, id: res.insertId, slug: uniqueSlug }
})
