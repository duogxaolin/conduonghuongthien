import { requireResourcePermission } from '../../../../utils/permissions'
import { createMediaCategoryRow } from '../../../../services/admin-media-categories'

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

  // The collision-safe slug (from the sent slug, else the name) is picked in the service.
  const rawSlug = String(body?.slug || '').trim()
  const created = await createMediaCategoryRow(rawSlug, { name, description, displayOrder })

  return { ok: true, id: created.id, slug: created.slug }
})
