import { getDb } from '../../../utils/db'
import { articles, users, categories, articleViewDaily } from '../../../db/schema'
import { eq, and, sql } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'Invalid slug' })

  try {
    const db = getDb()
    const [article] = await db
      .select({
        id:           articles.id,
        type:         articles.type,
        category:     articles.category,
        categoryId:   articles.categoryId,
        categoryName: categories.name,
        categorySlug: categories.slug,
        title:        articles.title,
        slug:         articles.slug,
        excerpt:      articles.excerpt,
        content:      articles.content,
        thumbnailUrl: articles.thumbnailUrl,
        publishedAt:  articles.publishedAt,
        createdAt:    articles.createdAt,
        authorName:   users.username,
        /**
         * Tổng lượt xem hiển thị (thật + ảo) — cùng con số `totalDisplayed` mà
         * trang quản trị báo, nên hai nơi không bao giờ nói hai điều khác nhau.
         * Correlated subquery chứ không join: `article_view_daily` có một hàng
         * mỗi ngày mỗi nguồn, join vào sẽ nhân bài viết lên nhiều hàng.
         */
        viewTotal: sql<number>`(
          SELECT COALESCE(SUM(${articleViewDaily.realViews} + ${articleViewDaily.fabricatedViews}), 0)
          FROM ${articleViewDaily}
          WHERE ${articleViewDaily.articleId} = ${articles.id}
        )`,
      })
      .from(articles)
      .leftJoin(users, eq(articles.authorId, users.id))
      .leftJoin(categories, eq(articles.categoryId, categories.id))
      .where(and(eq(articles.slug, slug), eq(articles.status, 'published')))
      .limit(1)

    if (!article) {
      throw createError({ statusCode: 404, statusMessage: 'Bài viết không tồn tại hoặc chưa xuất bản.' })
    }

    return { ok: true, article }
  } catch (err: any) {
    if (err?.statusCode === 404) throw err
    throw createError({ statusCode: 500, statusMessage: 'Lỗi máy chủ' })
  }
})
