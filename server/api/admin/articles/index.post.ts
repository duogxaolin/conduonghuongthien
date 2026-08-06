import { getDb } from '../../../utils/db'
import { articles, activityLogs } from '../../../db/schema'
import { sanitizeHtml } from '../../../utils/sanitize-html'
import { defaultCommentsEnabled } from '../../../services/google-oauth-settings'
import { requireResourcePermission } from '../../../utils/permissions'
// Bản dùng chung, KHÔNG phải một bản chép cục bộ. Endpoint này từng giữ bản riêng
// của nó, và bản đó thiếu đúng một dòng — phép cắt dấu gạch treo hai đầu — nên
// mọi tiêu đề mở đầu bằng ký tự bị lược sinh slug dị dạng: `"— Tin nóng —"` →
// `-tin-nong-`. Sáu endpoint khác (`categories`, `content-types`, `pages`) đều
// import bản này; chỉ đường tạo bài viết là lệch, và **`articles/[id].put.ts`
// không slugify lại**, nên một slug dị dạng sinh ra lúc tạo là vĩnh viễn: nó đi
// vào URL công khai `/news/<slug>`, vào email thông báo trả lời bình luận, và
// vào chỉ mục tìm kiếm.
import { slugify } from '../../../utils/slug'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser

  const body = await readBody(event).catch(() => ({}))
  const type = String(body?.type || 'news').trim()
  const category = String(body?.category || '').trim() || null
  const categoryId = body?.categoryId ? Number(body.categoryId) : null
  const title = String(body?.title || '').trim()
  const excerpt = String(body?.excerpt || '').trim() || null
  // Rich text is rendered with v-html on the public site — sanitize on write so
  // a low-privilege editor cannot store executable markup (stored XSS).
  const content = sanitizeHtml(String(body?.content || ''))
  const status = String(body?.status || 'draft').trim()
  const thumbnailUrl = String(body?.thumbnailUrl || '').trim() || null

  // Map resource permission by article type
  const resourceMap: Record<string, string> = {
    news: 'news',
    role_model: 'role_models',
    reintegration: 'reintegration',
    document: 'documents',
    faq: 'faq',
  }
  const permResource = resourceMap[type] || 'news'

  requireResourcePermission(adminUser, permResource, 'create')

  if (!title || title.length < 3) {
    throw createError({ statusCode: 400, statusMessage: 'Tiêu đề bài viết quá ngắn.' })
  }

  const baseSlug = slugify(title)
  const uniqueSlug = `${baseSlug}-${Date.now().toString(36)}`
  const publishedAt = status === 'published' ? new Date() : null

  // A new article takes the portal-wide default (design.md D9), which ships off.
  // An explicit value in the request wins so the create form can offer the switch
  // directly; without the stored default every new article would need a manual
  // toggle forever, and that permanent friction is what ends with somebody
  // changing the column default and reopening the whole archive.
  const commentsEnabled = body?.commentsEnabled !== undefined
    ? Boolean(body.commentsEnabled)
    : await defaultCommentsEnabled()

  const db = getDb()

  /**
   * Lượt ghi và dòng audit của nó commit cùng nhau, hoặc không cái nào.
   *
   * Viết rời, câu audit có cách hỏng riêng của nó — `activity_logs.user_id`
   * là khoá ngoại tới `users` và `meta` là cột JSON — nên một lượt ghi đã
   * xong có thể còn lại mà không có gì ghi lại ai đã làm. Chạy trên `tx`,
   * không phải `db`: một `db.insert()` đặt trong khối transaction vẫn
   * commit độc lập trên pool.
   */
  const newArticleId = await db.transaction(async (tx) => {
    const [res] = await tx.insert(articles).values({
      type,
      category,
      categoryId,
      title,
      slug: uniqueSlug,
      excerpt,
      content,
      status,
      thumbnailUrl,
      commentsEnabled,
      authorId: adminUser.id,
      publishedAt,
    })

    const created = res.insertId

    await tx.insert(activityLogs).values({
      userId: adminUser.id,
      action: 'create',
      resource: 'articles',
      resourceId: created,
      meta: { title, type, status, commentsEnabled },
    })

    return created
  })

  return { ok: true, id: newArticleId, slug: uniqueSlug }
})
