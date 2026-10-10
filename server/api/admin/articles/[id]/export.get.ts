import { getDb } from '../../../../utils/db'
import { articles, users, categories } from '../../../../db/schema'
import { eq } from 'drizzle-orm'
import { requireResourcePermission } from '../../../../utils/permissions'
import { articleResource } from '../../../../services/articles'
import { htmlToMarkdown } from '../../../../utils/html-to-markdown'

/**
 * Xuất 1 bài viết về file HTML (standalone) hoặc Markdown.
 *
 * `?format=html` (mặc định): bọc `content` trong template HTML đầy đủ để mở
 * standalone trên mọi máy, không cần server. Ảnh/embed giữ nguyên URL.
 * `?format=md`: chuyển HTML→Markdown bằng `html-to-markdown.ts` thuần — có tổn
 * thất (table/embed giữ HTML).
 *
 * Quyền: `read` trên `articleResource(article.type)` — export là đọc, không ghi,
 * không cần audit. Bài draft/archived vẫn tải được (khác với PDF qua public API
 * ở `/in-bai` — đó chỉ cho published).
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid article ID' })

  const format = String(getQuery(event).format || 'html').toLowerCase() === 'md' ? 'md' : 'html'

  const db = getDb()
  const [row] = await db
    .select({
      id: articles.id,
      type: articles.type,
      title: articles.title,
      slug: articles.slug,
      excerpt: articles.excerpt,
      content: articles.content,
      status: articles.status,
      thumbnailUrl: articles.thumbnailUrl,
      publishedAt: articles.publishedAt,
      createdAt: articles.createdAt,
      authorName: users.username,
      categoryName: categories.name,
    })
    .from(articles)
    .leftJoin(users, eq(articles.authorId, users.id))
    .leftJoin(categories, eq(articles.categoryId, categories.id))
    .where(eq(articles.id, id))
    .limit(1)

  if (!row) throw createError({ statusCode: 404, statusMessage: 'Bài viết không tồn tại.' })

  requireResourcePermission(adminUser, articleResource(row.type), 'read')

  const safeSlug = row.slug.replace(/[^\w-]/g, '_') || `bai-viet-${row.id}`
  const date = (row.publishedAt ?? row.createdAt ?? new Date())
  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

  const authorLine = row.authorName ? `Tác giả: ${row.authorName}` : ''
  const meta = [
    `Tiêu đề: ${row.title}`,
    row.categoryName ? `Danh mục: ${row.categoryName}` : '',
    authorLine,
    `Trạng thái: ${row.status}`,
    `Ngày: ${dateStr}`,
  ].filter(Boolean).join('\n')

  let body: string
  let filename: string
  let contentType: string

  if (format === 'md') {
    const mdContent = htmlToMarkdown(row.content ?? '')
    body = `# ${row.title}\n\n${meta}\n\n---\n\n${mdContent}\n`
    filename = `${safeSlug}.md`
    contentType = 'text/markdown; charset=utf-8'
  } else {
    const htmlContent = row.content ?? ''
    const excerpt = row.excerpt ? `<p class="excerpt">${escapeHtml(row.excerpt)}</p>\n` : ''
    body = `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(row.title)}</title>
  <style>
    body { font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; max-width: 820px; margin: 2rem auto; padding: 0 1rem; color: #1E251C; line-height: 1.7; }
    h1 { color: #1e4620; }
    .meta { color: #5A6C58; font-size: 0.85rem; border-bottom: 1px solid #e2ece3; padding-bottom: 0.5rem; margin-bottom: 1.5rem; }
    .meta p { margin: 0.1rem 0; }
    .excerpt { font-style: italic; color: #4A5545; border-left: 3px solid #4A6741; padding-left: 1rem; margin-bottom: 1.5rem; }
    img, video, iframe { max-width: 100%; height: auto; }
    a { color: #2c6e33; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #e2ece3; padding: 0.5rem; }
  </style>
</head>
<body>
  <h1>${escapeHtml(row.title)}</h1>
  <div class="meta">
    <p>${escapeHtml(meta.replace(/\n/g, ' · '))}</p>
  </div>
  ${excerpt}${htmlContent}
</body>
</html>`
    filename = `${safeSlug}.html`
    contentType = 'text/html; charset=utf-8'
  }

  setHeader(event, 'Content-Type', contentType)
  setHeader(event, 'Content-Disposition', `attachment; filename="${filename}"`)
  setHeader(event, 'Cache-Control', 'no-store')
  setHeader(event, 'Content-Length', Buffer.byteLength(body, 'utf8'))
  return body
})

/** Escape HTML để nhúng text an toàn vào template HTML export. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
