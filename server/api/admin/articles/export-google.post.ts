import { getDb } from '../../../utils/db'
import { articles, users, categories } from '../../../db/schema'
import { inArray, desc, eq } from 'drizzle-orm'
import { requireResourcePermission } from '../../../utils/permissions'
import { articleResource } from '../../../services/articles'
import { getUsableDriveLink } from '../../../services/backup-drive-oauth'
import { getUsableDriveOauthConfig } from '../../../services/backup-drive-oauth-config'
import { exportArticlesToGoogle, EXPORT_GOOGLE_MAX, type ExportArticleInput } from '../../../services/article-export-google'

/**
 * Xuất bài viết → Google Sheets + Google Docs (tạo file Google thật trên Drive
 * của admin đã liên kết backup OAuth).
 *
 * POST body: `{ ids: number[] }` (tối đa 50). Trả JSON `{ sheetUrl, folderUrl, count }`.
 *
 * Tạo 1 folder + 1 Google Sheets (list bài: ID, title, `=IMAGE(thumbnail)`, link
 * "Xem bài") + mỗi bài 1 Google Docs (title heading + meta + excerpt + content
 * HTML→Docs API full rich). Chạy tuần tự — 1-2 phút cho 50 bài.
 *
 * Quyền: per-bài `requireResourcePermission(read)` — bài không có quyền bị bỏ qua.
 * Google OAuth: tái use backup Drive OAuth — `getUsableDriveLink` (refresh token)
 * + `getUsableDriveOauthConfig` (clientId/secret). Chưa linked → 400.
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser

  const body = await readBody<{ ids?: number[] }>(event).catch(() => ({ ids: [] }))
  const ids = Array.isArray(body.ids) ? body.ids.filter((n: number) => Number.isFinite(n) && n > 0) : []
  if (ids.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Thiếu danh sách bài viết.' })
  }
  if (ids.length > EXPORT_GOOGLE_MAX) {
    throw createError({ statusCode: 400, statusMessage: `Tối đa ${EXPORT_GOOGLE_MAX} bài mỗi lần tải.` })
  }

  // Fetch articles + author + category + thumbnail.
  const db = getDb()
  const rows = await db
    .select({
      id: articles.id,
      type: articles.type,
      title: articles.title,
      slug: articles.slug,
      excerpt: articles.excerpt,
      content: articles.content,
      thumbnailUrl: articles.thumbnailUrl,
      authorName: users.username,
      categoryName: categories.name,
      publishedAt: articles.publishedAt,
      createdAt: articles.createdAt,
    })
    .from(articles)
    .leftJoin(users, eq(articles.authorId, users.id))
    .leftJoin(categories, eq(articles.categoryId, categories.id))
    .where(inArray(articles.id, ids))
    .orderBy(desc(articles.createdAt))

  // Lọc per-bài theo quyền.
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

  // Lấy Google OAuth — backup Drive link + config.
  const link = await getUsableDriveLink()
  if (!link.ok) {
    throw createError({
      statusCode: 400,
      statusMessage: link.reason === 'secret_unreadable'
        ? 'Khoá mã hoá Google Drive không đọc được — xoay CHATBOT_ENCRYPTION_SECRET rồi re-link.'
        : 'Chưa liên kết Google Drive. Vào /admin/settings → backup Drive để liên kết.',
    })
  }
  const config = await getUsableDriveOauthConfig()
  if (!config.ok) {
    throw createError({
      statusCode: 400,
      statusMessage: config.reason === 'secret_unreadable'
        ? 'Client secret Google Drive không đọc được — re-link OAuth.'
        : 'Chưa cấu hình Google Drive OAuth Client. Vào /admin/settings → backup Drive.',
    })
  }

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const input: ExportArticleInput[] = allowed.map(r => ({
    id: r.id,
    title: r.title ?? '',
    slug: r.slug ?? '',
    excerpt: r.excerpt,
    content: r.content,
    thumbnailUrl: r.thumbnailUrl,
    authorName: r.authorName,
    categoryName: r.categoryName,
    publishedAt: r.publishedAt,
    createdAt: r.createdAt,
  }))

  const result = await exportArticlesToGoogle(link.refreshToken, config.clientId, config.clientSecret, input, stamp)

  return result
})
