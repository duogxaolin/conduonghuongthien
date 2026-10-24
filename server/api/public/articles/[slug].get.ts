import { sanitizeHtml } from '../../../utils/sanitize-html'
import { plainTextField, withPlainTextFields } from '../../../utils/decode-html-entities'
import { getDb } from '../../../utils/db'
import { articles, users, categories, articleTranslations } from '../../../db/schema'
import { eq, and, inArray } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'Invalid slug' })

  const query = getQuery(event)
  const cookieLang = getCookie(event, 'cdkt_lang')?.trim().toLowerCase() || ''
  const lang = (typeof query.lang === 'string' ? query.lang.trim().toLowerCase() : '') || cookieLang

  try {
    const db = getDb()
    const [found] = await db
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
        // Displayed total (real + fabricated), read from the maintained column
        // (wave2 design D6) instead of summing `article_view_daily` per request.
        // Never the real/fabricated split.
        viewTotal:    articles.viewTotal,
      })
      .from(articles)
      .leftJoin(users, eq(articles.authorId, users.id))
      .leftJoin(categories, eq(articles.categoryId, categories.id))
      .where(and(eq(articles.slug, slug), eq(articles.status, 'published')))
      .limit(1)

    if (!found) {
      throw createError({ statusCode: 404, statusMessage: 'Bài viết không tồn tại hoặc chưa xuất bản.' })
    }
    // Imported excerpts carry HTML entities (`Ng&agrave;y`); decoded here, not in the DB.
    const article = withPlainTextFields(found)

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
          inArray(articleTranslations.status, ['published', 'ai_draft', 'reviewed']),
        ))
        .limit(1)

      if (translation && translation.title && translation.title.trim()) {
        return {
          ok: true,
          article: {
            ...article,
            title:    plainTextField(translation.title) ?? article.title,
            excerpt:  plainTextField(translation.excerpt) ?? article.excerpt,
            // Lọc lúc đọc: bản dịch ghi trước khi có lớp lọc lúc ghi vẫn nằm trong DB.
            content:  translation.content == null ? article.content : sanitizeHtml(translation.content),
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
