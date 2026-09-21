/**
 * Đếm số ảnh theo provider (local / r2) — dùng cho trang đồng bộ storage để
 * hiện số lượng hiện tại trước khi bấm chuyển.
 */
import { sql } from 'drizzle-orm'
import { getDb } from '../../../utils/db'
import { media } from '../../../db/schema'
import { requireResourcePermission } from '../../../utils/permissions'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'media', 'read')

  const db = getDb()
  const rows = await db
    .select({ provider: media.provider, count: sql<number>`COUNT(*)` })
    .from(media)
    .groupBy(media.provider)

  const local = rows.find(r => r.provider === 'local')?.count ?? 0
  const r2 = rows.find(r => r.provider === 'r2')?.count ?? 0
  return { ok: true, local, r2 }
})
