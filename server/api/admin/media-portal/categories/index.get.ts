import { getDb } from '../../../../utils/db'
import { mediaCategories, mediaItems } from '../../../../db/schema'
import { asc, count, isNotNull } from 'drizzle-orm'
import { requireResourcePermission } from '../../../../utils/permissions'

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

  const db = getDb()

  // Hai lượt đọc độc lập, chạy cùng lúc: số video dùng từng danh mục không phụ
  // thuộc thứ tự danh sách.
  const [rows, usage] = await Promise.all([
    db
      .select({
        id: mediaCategories.id,
        name: mediaCategories.name,
        slug: mediaCategories.slug,
        description: mediaCategories.description,
        displayOrder: mediaCategories.displayOrder,
        createdAt: mediaCategories.createdAt,
      })
      .from(mediaCategories)
      .orderBy(asc(mediaCategories.displayOrder), asc(mediaCategories.id)),
    db
      .select({ categoryId: mediaItems.categoryId, total: count() })
      .from(mediaItems)
      .where(isNotNull(mediaItems.categoryId)) // loại NULL — đếm video có danh mục
      .groupBy(mediaItems.categoryId),
  ])

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
