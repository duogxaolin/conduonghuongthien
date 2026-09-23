import { getDb } from '../../../../utils/db'
import { mediaCategories } from '../../../../db/schema'
import { uniqueMediaCategorySlug } from '../../../../utils/slug'
import { requireResourcePermission } from '../../../../utils/permissions'

/**
 * Tạo danh mục Media Portal. RBAC: `media_portal.create`.
 *
 * Không kèm `activity_logs`: danh mục media là cấu hình nhỏ (không chở dữ liệu
 * công dân), và theo dõi mỗi lượt sửa tên danh mục không phải câu hỏi nhật ký
 * kiểm toán phải trả lời. Cùng lý do `/admin/settings` không audit từng khoá.
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'media_portal', 'create')

  const body = await readBody(event).catch(() => ({}))
  const name = String(body?.name || '').trim()
  const description = String(body?.description || '').trim() || null
  const displayOrder = Number(body?.displayOrder ?? 0)

  if (!name) {
    throw createError({ statusCode: 400, statusMessage: 'Tên danh mục không được để trống.' })
  }

  const db = getDb()

  // Clean, collision-safe slug — dùng `media_categories` (tách khỏi `categories`).
  const rawSlug = String(body?.slug || '').trim()
  const uniqueSlug = await uniqueMediaCategorySlug(db, rawSlug || name)

  const [res] = await db.insert(mediaCategories).values({
    name,
    slug: uniqueSlug,
    description,
    displayOrder: Number.isFinite(displayOrder) ? Math.floor(displayOrder) : 0,
  })

  return { ok: true, id: res.insertId, slug: uniqueSlug }
})
