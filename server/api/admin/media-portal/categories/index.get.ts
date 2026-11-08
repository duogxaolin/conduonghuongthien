import { requireResourcePermission } from '../../../../utils/permissions'
import { listMediaCategoriesWithUsage } from '../../../../services/admin-media-categories'

/**
 * Danh sách danh mục Media Portal + số video đang dùng từng danh mục.
 *
 * RBAC dùng `media_portal.read` — danh mục video là cấu hình của Media Portal,
 * không phải tài nguyên riêng (tiền lệ `readers`/`comments`: tách resource là buộc
 * cấp lại quyền cho mọi vai trò đang có trước khi trang chạy được).
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'media_portal', 'read')

  const { rows, usage } = await listMediaCategoriesWithUsage()

  const usageMap = new Map<number, number>()
  for (const u of usage) {
    if (u.categoryId != null) usageMap.set(Number(u.categoryId), Number(u.total))
  }

  return {
    ok: true,
    items: rows.map(row => ({
      ...row,
      usageCount: usageMap.get(Number(row.id)) ?? 0,
    })),
  }
})
