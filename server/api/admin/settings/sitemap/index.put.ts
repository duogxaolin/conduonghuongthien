
import { requireResourcePermission } from '../../../../utils/permissions'
import { saveSitemapWithAudit } from '../../../../services/admin-settings-sitemap'

/**
 * Lưu sitemap admin đã sửa. Cặp ghi + audit trong một transaction
 * (`saveSitemapWithAudit`, services/admin-settings-sitemap.ts).
 *
 * Không validate XML chặt: admin có thể chỉnh tay và muốn giữ lại những thứ
 * builder không sinh (ví dụ `priority` tuỳ chỉnh, comment XML). Chỉ chặn rỗng
 * và vượt giới hạn mềm 500KB (sitemap > 50MB bị Google từ chối — 500KB là ngưỡng
 * sớm cảnh báo, không phải hard limit).
 */
const MAX_XML = 500_000

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'update')

  const body = await readBody(event).catch(() => ({}))
  const xml = typeof body?.xml === 'string' ? body.xml : ''

  if (!xml.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'Sitemap không được để trống.' })
  }
  if (xml.length > MAX_XML) {
    throw createError({ statusCode: 400, statusMessage: `Sitemap quá lớn (> ${MAX_XML} ký tự). Google từ chối sitemap > 50MB.` })
  }

  const now = new Date().toISOString()

  // Both rows and the audit row, in one transaction (in the service).
  await saveSitemapWithAudit(adminUser, xml, now)

  return { ok: true, updatedAt: now }
})
