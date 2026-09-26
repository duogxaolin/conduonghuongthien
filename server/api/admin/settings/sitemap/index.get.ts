import { eq } from 'drizzle-orm'

import { getDb } from '../../../../utils/db'
import { settings } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'
import { requestBase } from '../../../../utils/google-oauth/config'
import { generateSitemap } from '../../../../utils/sitemap-builder'

/**
 * Trả sitemap hiện tại + bản sinh sẵn để UI điền vào textarea.
 *
 * - `xml`: bản đã lưu (hoặc `null` nếu chưa có).
 * - `updatedAt`: lần lưu cuối.
 * - `generated`: bản sinh mới từ DB, để JS side có ngay mà không gọi thêm
 *   endpoint. Dùng `requestBase(event)` cho đa domain (tiền lệ Google OAuth).
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'read')

  const db = getDb()
  const rows = await db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(eq(settings.key, 'sitemap_xml'))

  const xmlRow = rows.find((r) => r.key === 'sitemap_xml')
  const tsRow = rows.find((r) => r.key === 'sitemap_updated_at')

  const baseUrl = requestBase(event).replace(/\/+$/, '')
  const generated = await generateSitemap(baseUrl, db)

  return {
    ok: true,
    xml: xmlRow?.value && xmlRow.value.trim() ? xmlRow.value : null,
    updatedAt: tsRow?.value ?? null,
    generated,
  }
})
