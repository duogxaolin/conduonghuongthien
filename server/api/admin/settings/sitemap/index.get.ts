import { inArray } from 'drizzle-orm'

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
  // Both rows `index.put.ts` writes. Selecting `sitemap_xml` alone left `tsRow` always
  // undefined, so "Lần lưu cuối" vanished on every reload
  // (tests/admin-sitemap-updated-at-behavior.test.ts).
  const rows = await db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(inArray(settings.key, ['sitemap_xml', 'sitemap_updated_at']))

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
