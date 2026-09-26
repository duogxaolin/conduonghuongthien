import { requireResourcePermission } from '../../../../utils/permissions'
import { requestBase } from '../../../../utils/google-oauth/config'
import { generateSitemap } from '../../../../utils/sitemap-builder'

/**
 * Sinh lại sitemap từ DB (không lưu). UI gọi khi admin bấm "Sinh lại" sau khi đã
 * có bản lưu — JS sẽ hỏi confirm đè trước khi gọi endpoint này. Trả text XML mới
 * để điền vào textarea; admin vẫn phải bấm "Lưu" để persist.
 *
 * Quyền `settings.read` (không phải `update`): thao tác này chỉ đọc DB, chưa ghi
 * gì. Cùng phân vì với `index.get.ts` trả `generated`.
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'read')

  const baseUrl = requestBase(event).replace(/\/+$/, '')
  const xml = await generateSitemap(baseUrl)
  return { ok: true, xml }
})
