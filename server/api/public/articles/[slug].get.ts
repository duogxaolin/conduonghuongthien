import { getDb } from '../../../utils/db'
import { articles, users, categories, articleViewDaily, articleTranslations } from '../../../db/schema'
import { eq, and, sql } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'Invalid slug' })

  const query = getQuery(event)
  const lang = typeof query.lang === 'string' ? query.lang.trim().toLowerCase() : ''

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
        viewTotal: sql<number>`(
          SELECT COALESCE(SUM(\`v\`.\`real_views\` + \`v\`.\`fabricated_views\`), 0)
          FROM \`article_view_daily\` \`v\`
          WHERE \`v\`.\`article_id\` = \`articles\`.\`id\`
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

    // If a language is requested, check for a published translation
    if (lang && lang !== 'vi') {
      const [translation] = await db
        .select({
          title:   articleTranslations.title,
          excerpt: articleTranslations.excerpt,
          content: articleTranslations.content,
          status:  articleTranslations.status,
        })
        .from(articleTranslations)
        .where(and(
          eq(articleTranslations.articleId, article.id),
          eq(articleTranslations.langCode, lang),
          eq(articleTranslations.status, 'published'),
        ))
        .limit(1)

      if (translation && translation.title !== null) {
        return {
          ok: true,
          article: {
            ...article,
            title:    translation.title,
            excerpt:  translation.excerpt ?? article.excerpt,
            content:  translation.content ?? article.content,
            translatedFrom: 'vi',
          },
        }
      }

      // No published translation — list available languages
      const availableRows = await db
        .select({ langCode: articleTranslations.langCode })
        .from(articleTranslations)
        .where(and(
          eq(articleTranslations.articleId, article.id),
          eq(articleTranslations.status, 'published'),
        ))

      return {
        ok: true,
        article,
        availableTranslations: availableRows.map((r) => r.langCode),
      }
    }

    return { ok: true, article }
  } catch (err: unknown) {
    if ((err as { statusCode?: number })?.statusCode === 404) throw err
    throw createError({ statusCode: 500, statusMessage: 'Lỗi máy chủ' })
  }
})
