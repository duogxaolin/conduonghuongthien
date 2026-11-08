import { createError, defineEventHandler, getRouterParam } from 'h3'
import { requireResourcePermission } from '../../../../utils/permissions'
import { countMediaItemsInCategory, deleteMediaCategoryRow, findMediaCategoryById } from '../../../../services/admin-media-categories'

/**
 * Xoá danh mục Media Portal. RBAC: `media_portal.delete`.
 *
 * Từ chối nếu còn video đang dùng danh mục — cùng guard `deleteCategoryById`
 * (services/categories.ts:36) cho danh mục bài viết. `media_items.category_id`
 * có `ON DELETE SET NULL` nên DB cho phép xoá, nhưng xoá âm thầm làm mất phân loại
 * của video đang công khai; cán bộ phải chuyển video sang danh mục khác trước.
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'media_portal', 'delete')

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'ID danh mục không hợp lệ.' })

  const existing = await findMediaCategoryById(id)
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Danh mục không tồn tại.' })

  const usageCount = await countMediaItemsInCategory(id)
  if (Number(usageCount) > 0) {
    throw createError({
      statusCode: 400,
      statusMessage: `Không thể xóa danh mục đang có ${usageCount} video. Hãy chuyển video sang danh mục khác trước.`,
    })
  }

  await deleteMediaCategoryRow(id)
  return { ok: true }
})
