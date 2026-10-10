import { getDb } from '../../../utils/db'
import { articles, users, categories } from '../../../db/schema'
import { ArticleFilterValidationError, parseAuthorFilter } from '../../../utils/article-filters'
import { articleReadScope } from '../../../services/articles'
import { eq, like, desc, sql, inArray, isNull } from 'drizzle-orm'
import { alias } from 'drizzle-orm/mysql-core'

/**
 * Xuất danh sách bài viết về file CSV (có BOM UTF-8 để Excel mở đúng tiếng Việt).
 *
 * Hai chế độ (cùng một endpoint):
 *  - `?ids=1,2,3` — chỉ xuất các bài đã chọn (BulkActionBar), bỏ qua filter.
 *  - Không `ids` — xuất theo filter hiện tại (search/type/status/category/author/
 *    translation), tối đa 500 bài (mới nhất) để tránh OOM khi cơ quan có nhiều
 *    bài. Trang list đã có phân trang, CSV là báo cáo gộp, không phải export toàn
 *    CSDL.
 *
 * Quyền: `read` trên type каждого bài. Khi `ids`, lọc bỏ bài không có quyền;
 *  khi filter, `articleReadScope` giới hạn scope theo quyền của admin (editor
 *  chỉ có `articles.read` type `news` → `articleReadScope` ép `type='news'`).
 */
const MAX_EXPORT = 500

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  const query = getQuery(event)

  const db = getDb()
  const parentCategories = alias(categories, 'parentCategories')

  // Phân nhánh theo `ids` (đã chọn) hay theo filter.
  const idsParam = String(query.ids || '').trim()
  let idList: number[] = []
  if (idsParam) {
    idList = idsParam
      .split(',')
      .map(s => Number(s.trim()))
      .filter(n => Number.isFinite(n) && n > 0)
      .slice(0, 1000)
    if (idList.length === 0) {
      throw createError({ statusCode: 400, statusMessage: 'Tham số ids không hợp lệ.' })
    }
  }

  // Điều kiện where.
  const conditions = [articleReadScope(adminUser)]

  if (idList.length) {
    conditions.push(inArray(articles.id, idList))
  } else {
    // Filter giống index.get.ts.
    const search = String(query.search || '').trim()
    const typeFilter = String(query.type || '').trim()
    const statusFilter = String(query.status || '').trim()
    const categoryIdFilter = query.categoryId ? Number(query.categoryId) : null
    const translationFilter = String(query.translation || '').trim()

    let authorFilter
    try {
      authorFilter = parseAuthorFilter(query.authorId)
    } catch (err) {
      if (err instanceof ArticleFilterValidationError) {
        throw createError({ statusCode: 400, statusMessage: err.message })
      }
      throw err
    }

    if (search) conditions.push(like(articles.title, `%${search}%`))
    if (typeFilter) conditions.push(eq(articles.type, typeFilter))
    if (statusFilter) conditions.push(eq(articles.status, statusFilter))
    if (categoryIdFilter) conditions.push(eq(articles.categoryId, categoryIdFilter))
    if (authorFilter.kind === 'user') conditions.push(eq(articles.authorId, authorFilter.userId))
    else if (authorFilter.kind === 'none') conditions.push(isNull(articles.authorId))
    if (translationFilter.startsWith('missing_')) {
      const lang = translationFilter.slice(8)
      conditions.push(sql`NOT EXISTS (SELECT 1 FROM \`article_translations\` \`t\` WHERE \`t\`.\`article_id\` = \`articles\`.\`id\` AND \`t\`.\`lang_code\` = ${lang})`)
    } else if (translationFilter.startsWith('has_')) {
      const lang = translationFilter.slice(4)
      conditions.push(sql`EXISTS (SELECT 1 FROM \`article_translations\` \`t\` WHERE \`t\`.\`article_id\` = \`articles\`.\`id\` AND \`t\`.\`lang_code\` = ${lang})`)
    }
  }

  const whereClause = sql.join(conditions, sql` AND `)

  const items = await db
    .select({
      id: articles.id,
      type: articles.type,
      title: articles.title,
      slug: articles.slug,
      status: articles.status,
      categoryName: categories.name,
      authorName: users.username,
      viewTotal: sql<number>`(
        SELECT COALESCE(SUM(\`v\`.\`real_views\` + \`v\`.\`fabricated_views\`), 0)
        FROM \`article_view_daily\` \`v\`
        WHERE \`v\`.\`article_id\` = \`articles\`.\`id\`
      )`,
      publishedAt: articles.publishedAt,
      createdAt: articles.createdAt,
    })
    .from(articles)
    .leftJoin(users, eq(articles.authorId, users.id))
    .leftJoin(categories, eq(articles.categoryId, categories.id))
    .leftJoin(parentCategories, eq(categories.parentId, parentCategories.id))
    .where(whereClause)
    .orderBy(desc(articles.createdAt))
    .limit(MAX_EXPORT)

  // Sinh CSV.
  const statusLabels: Record<string, string> = { published: 'Đã xuất bản', draft: 'Bản nháp', archived: 'Lưu trữ' }
  const header = ['ID', 'Tiêu đề', 'Slug', 'Thể loại', 'Danh mục', 'Trạng thái', 'Tác giả', 'Lượt xem', 'Ngày tạo', 'Ngày xuất bản']
  const rows: string[] = [header.map(csvField).join(',')]

  for (const a of items) {
    const fmtDate = (d: Date | null | string) => {
      if (!d) return ''
      const dt = d instanceof Date ? d : new Date(d)
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
    }
    rows.push([
      a.id,
      a.title ?? '',
      a.slug ?? '',
      a.type ?? '',
      a.categoryName ?? '',
      statusLabels[a.status] ?? a.status,
      a.authorName ?? '',
      Number(a.viewTotal ?? 0).toLocaleString('vi-VN'),
      fmtDate(a.createdAt),
      fmtDate(a.publishedAt),
    ].map(csvField).join(','))
  }

  // BOM UTF-8 ở đầu file để Excel nhận mã hoá, không hỏi charset.
  const csv = '﻿' + rows.join('\r\n')
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')

  setHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
  setHeader(event, 'Content-Disposition', `attachment; filename="bai-viet-${stamp}.csv"`)
  setHeader(event, 'Cache-Control', 'no-store')
  setHeader(event, 'Content-Length', Buffer.byteLength(csv, 'utf8'))
  return csv
})

/** Bọc field CSV: bọc trong " nếu chứa , " \n; escape " thành "". */
function csvField(value: unknown): string {
  const s = String(value ?? '')
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}
