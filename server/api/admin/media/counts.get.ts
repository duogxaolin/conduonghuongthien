/**
 * Đếm số ảnh theo provider (local / r2) — dùng cho trang đồng bộ storage để
 * hiện số lượng hiện tại trước khi bấm chuyển.
 */
import { requireResourcePermission } from '../../../utils/permissions'
import { countMediaByProvider } from '../../../services/admin-media-library'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'media', 'read')

  const rows = await countMediaByProvider()

  const local = rows.find(r => r.provider === 'local')?.count ?? 0
  const r2 = rows.find(r => r.provider === 'r2')?.count ?? 0
  return { ok: true, local, r2 }
})
