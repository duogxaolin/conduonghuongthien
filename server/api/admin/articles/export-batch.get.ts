import { getDb } from '../../../utils/db'
import { articles, users, categories } from '../../../db/schema'
import { eq, desc, inArray } from 'drizzle-orm'
import { requireResourcePermission } from '../../../utils/permissions'
import { articleResource } from '../../../services/articles'
import { vietnamDateString } from '../../../utils/vn-day-range'
import archiver from 'archiver'
import { Readable } from 'node:stream'

/**
 * Xuất nhiều bài viết về file ZIP — mỗi bài một file .html standalone.
 *
 * `?ids=1,2,3` (bắt buộc, tối đa 50). Giới hạn 50 vì mỗi bài fetch content
 * (longtext TinyMCE) + zip giữ trong memory stream; quá 50 sẽ nặng và亦 không
 * ai tải 50 bài cùng lúc để báo cáo.
 *
 * Quyền: kiểm per-bài `requireResourcePermission(read)` — bài không có quyền bị
 * bỏ qua (không throw 403 toàn batch, để editor có type hạn chế vẫn tải được
 * phần bài mình được xem). Nếu 0 bài qua được quyền → 403.
 *
 * HTML mỗi bài dùng cùng template standalone như `[id]/export.get.ts` — giữ
 * khối thống nhất, không trùng logic (xem file đó cho template đầy đủ).
 */
const MAX_BATCH = 50

function buildArticleHtml(row: {
  id: number
  title: string
  slug: string
  excerpt: string | null
  content: string | null
  status: string
  categoryName: string | null
  authorName: string | null
  publishedAt: Date | null
  createdAt: Date | null
}): string {
  const dateStr = vietnamDateString(row.publishedAt ?? row.createdAt ?? new Date())
  const meta = [
    `Tiêu đề: ${row.title}`,
    row.categoryName ? `Danh mục: ${row.categoryName}` : '',
    row.authorName ? `Tác giả: ${row.authorName}` : '',
    `Trạng thái: ${row.status}`,
    `Ngày: ${dateStr}`,
  ].filter(Boolean).join(' · ')
  const amp = '&' + 'amp;'
  const lt = '&' + 'lt;'
  const gt = '&' + 'gt;'
  const quot = '&' + 'quot;'
  const esc = (s: string) => s.replace(/&/g, amp).replace(/</g, lt).replace(/>/g, gt).replace(/"/g, quot)
  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(row.title)}</title>
  <style>
    body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; max-width: 820px; margin: 2rem auto; padding: 0 1rem; color: #1E251C; line-height: 1.7; }
    h1 { color: #1e4620; }
    .meta { color: #5A6C58; font-size: 0.85rem; border-bottom: 1px solid #e2ece3; padding-bottom: 0.5rem; margin-bottom: 1.5rem; }
    .excerpt { font-style: italic; color: #4A5545; border-left: 3px solid #4A6741; padding-left: 1rem; margin-bottom: 1.5rem; }
    img, video, iframe { max-width: 100%; height: auto; }
  </style>
</head>
<body>
  <h1>${esc(row.title)}</h1>
  <div class="meta"><p>${esc(meta)}</p></div>
  ${row.excerpt ? `<p class="excerpt">${esc(row.excerpt)}</p>` : ''}
  ${row.content ?? ''}
</body>
</html>`
}

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  const idsParam = String(getQuery(event).ids || '').trim()
  if (!idsParam) {
    throw createError({ statusCode: 400, statusMessage: 'Thiếu tham số ids.' })
  }
  const ids = idsParam
    .split(',')
    .map(s => Number(s.trim()))
    .filter(n => Number.isFinite(n) && n > 0)
  if (ids.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Tham số ids không hợp lệ.' })
  }
  if (ids.length > MAX_BATCH) {
    throw createError({ statusCode: 400, statusMessage: `Tối đa ${MAX_BATCH} bài mỗi lần tải.` })
  }

  const db = getDb()
  const rows = await db
    .select({
      id: articles.id,
      type: articles.type,
      title: articles.title,
      slug: articles.slug,
      excerpt: articles.excerpt,
      content: articles.content,
      status: articles.status,
      categoryName: categories.name,
      authorName: users.username,
      publishedAt: articles.publishedAt,
      createdAt: articles.createdAt,
    })
    .from(articles)
    .leftJoin(users, eq(articles.authorId, users.id))
    .leftJoin(categories, eq(articles.categoryId, categories.id))
    .where(inArray(articles.id, ids))
    .orderBy(desc(articles.createdAt))

  // Lọc per-bài theo quyền — bỏ bài không có quyền, đếm.
  const allowed = rows.filter(r => {
    try {
      requireResourcePermission(adminUser, articleResource(r.type), 'read')
      return true
    } catch {
      return false
    }
  })
  if (allowed.length === 0) {
    throw createError({ statusCode: 403, statusMessage: 'Bạn không có quyền đọc bài nào trong danh sách đã chọn.' })
  }

  const stamp = vietnamDateString(new Date()).replace(/-/g, '')
  const zip = archiver('zip', { zlib: { level: 6 } })
  for (const r of allowed) {
    const safeSlug = (r.slug || `bai-viet-${r.id}`).replace(/[^\w-]/g, '_')
    zip.append(Readable.from([buildArticleHtml(r)]), { name: `${safeSlug}.html` })
  }
  zip.finalize()

  setHeader(event, 'Content-Type', 'application/zip')
  setHeader(event, 'Content-Disposition', `attachment; filename="bai-viet-${stamp}.zip"`)
  setHeader(event, 'Cache-Control', 'no-store')
  return sendStream(event, zip)
})
