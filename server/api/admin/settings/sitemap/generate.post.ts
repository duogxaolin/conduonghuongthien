import { requireResourcePermission } from '../../../../utils/permissions'
import { publicLinkBase } from '../../../../utils/public-link-base'
import { generateSitemap } from '../../../../utils/sitemap-builder'

/**
 * Sinh lại sitemap từ DB (không lưu). UI gọi khi admin bấm "Sinh lại" sau khi đã
 * có bản lưu — JS sẽ hỏi confirm đè trước khi gọi endpoint này. Trả text XML mới
 * để điền vào textarea; admin vẫn phải bấm "Lưu" để persist.
 *
 * Gốc URL qua `publicLinkBase` (không phải `requestBase`): bản này được LƯU rồi phục
 * nguyên văn cho mọi khách (`server/routes/sitemap.xml.ts`), nên host của trình duyệt
 * admin chỉ được dùng khi nằm trong `PUBLIC_HOST_ALLOWLIST` / là host của
 * `PUBLIC_BASE_URL` — sinh khi duyệt qua 127.0.0.1 hay IP thì lùi về `PUBLIC_BASE_URL`
 * (§ 70; tests/sitemap-generate-link-base.test.ts).
 *
 * Quyền `settings.read` (không phải `update`): thao tác này chỉ đọc DB, chưa ghi
 * gì. Cùng phân vì với `index.get.ts` trả `generated`.
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'read')

  const baseUrl = publicLinkBase(event).replace(/\/+$/, '')
  const xml = await generateSitemap(baseUrl)
  return { ok: true, xml }
})
