import { eq } from 'drizzle-orm'

import { getDb } from '../utils/db'
import { settings } from '../db/schema'
import { logError } from '../utils/logger'
import { requestBase } from '../utils/google-oauth/config'

/**
 * `/sitemap.xml` — phục ráp máy quét tìm kiếm.
 *
 * Bản được phục ra là bản admin đã **lưu** (sửa được). Khi chưa có bản lưu, lùi
 * về sitemap tĩnh chỉ chứa URL các trang cố định + danh sách — không sinh động từ
 * DB. Lý do: sinh động là mất quyền sửa của admin — bản admin vừa chỉnh phải
 * là bản khách nhận. Lần triển khai đầu tiên `sitemap_xml` rỗng, máy quét vẫn nhận
 * một sitemap hợp lệ thay vì 404.
 *
 * Không bao giờ ném lỗi ra ngoài: một sitemap không có tư cách trả lỗi cho khách
 * (tiền lệ `favicon.ico.ts`). DB hỏng → fallback tĩnh.
 */

const STATIC_FALLBACK = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>__BASE__/</loc><changefreq>monthly</changefreq><priority>1.0</priority></url>
  <url><loc>__BASE__/about</loc><changefreq>monthly</changefreq><priority>0.5</priority></url>
  <url><loc>__BASE__/contact</loc><changefreq>monthly</changefreq><priority>0.5</priority></url>
  <url><loc>__BASE__/news</loc><changefreq>daily</changefreq><priority>0.9</priority></url>
  <url><loc>__BASE__/role-models</loc><changefreq>daily</changefreq><priority>0.9</priority></url>
  <url><loc>__BASE__/reintegration-models</loc><changefreq>daily</changefreq><priority>0.9</priority></url>
  <url><loc>__BASE__/documents</loc><changefreq>daily</changefreq><priority>0.7</priority></url>
  <url><loc>__BASE__/legal-qa</loc><changefreq>daily</changefreq><priority>0.7</priority></url>
  <url><loc>__BASE__/qa-documents</loc><changefreq>daily</changefreq><priority>0.7</priority></url>
</urlset>`

export default defineEventHandler(async (event) => {
  const base = requestBase(event).replace(/\/+$/, '')
  let xml = STATIC_FALLBACK.replace(/__BASE__/g, base)

  try {
    const db = getDb()
    const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, 'sitemap_xml'))
    if (row?.value && row.value.trim()) {
      xml = row.value
    }
  } catch (err) {
    logError({ event: 'sitemap.serve_failed', error: String(err) })
  }

  setResponseHeader(event, 'Content-Type', 'application/xml; charset=utf-8')
  return xml
})
