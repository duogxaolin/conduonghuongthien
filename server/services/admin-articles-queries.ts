/**
 * Read queries of the admin article screens, moved out of their handlers verbatim (2026-11-08: no
 * `server/api` file calls getDb() itself):
 *   - `GET /api/admin/articles` (index.get.ts) — the list page and its count;
 *   - `GET /api/admin/articles/:id` ([id].get.ts) — the editor's row;
 *   - `GET /api/admin/articles/authors` (authors.get.ts) — the author filter;
 *   - `GET /api/admin/articles/translation-stats`, `…/bulk-translate-status`, `…/:id/translations/:lang`.
 *
 * Every permission decision stays in the handler, in its old place: `articleReadScope` /
 * `articleActionScope` THROW 403 (they are checks, not only conditions), so the handler builds the scope
 * — or the whole WHERE clause of a list — and passes it here.
 */
import { and, asc, count, desc, eq, isNull, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/mysql-core'
import { getDb } from '../utils/db'
import { articles, articleTranslations, categories, languages, users } from '../db/schema'

/** One page of the admin list under `whereClause` (built by the handler), then the count under the same clause. */
export async function listAdminArticlesPage(whereClause: SQL | undefined, perPage: number, offset: number) {
  const db = getDb()
  const parentCategories = alias(categories, 'parentCategories')

  const items = await db
    .select({
      id:           articles.id,
      type:         articles.type,
      category:     articles.category,
      categoryId:       articles.categoryId,
      categoryName:     categories.name,
      categoryParentId: categories.parentId,
      parentCategoryName: parentCategories.name,
      title:        articles.title,
      slug:         articles.slug,
      excerpt:      articles.excerpt,
      status:       articles.status,
      thumbnailUrl: articles.thumbnailUrl,
      commentsEnabled: articles.commentsEnabled,
      publishedAt:  articles.publishedAt,
      createdAt:    articles.createdAt,
      updatedAt:    articles.updatedAt,
      authorName:   users.username,
      /**
       * Total displayed views (real + fabricated) per row — the maintained column
       * (wave2 design D6), equal to the sum of the article's `article_view_daily`
       * rows. It replaced a correlated subquery per row; the real/fabricated split
       * is in the per-article stats modal (`getArticleViewStats`), not here.
       */
      viewTotal:    articles.viewTotal,
      translatedLangs: sql<string>`(
        SELECT COALESCE(GROUP_CONCAT(DISTINCT CONCAT(\`t\`.\`lang_code\`, ':', \`t\`.\`status\`) SEPARATOR ','), '')
        FROM \`article_translations\` \`t\`
        WHERE \`t\`.\`article_id\` = \`articles\`.\`id\`
      )`,
    })
    .from(articles)
    .leftJoin(users, eq(articles.authorId, users.id))
    .leftJoin(categories, eq(articles.categoryId, categories.id))
    .leftJoin(parentCategories, eq(categories.parentId, parentCategories.id))
    .where(whereClause)
    // `id` breaks ties: articles imported in one second share `created_at`, and MySQL returns tied
    // rows in any order — two pages could share or skip one (FINDING-R7-9, as R6-9).
    .orderBy(desc(articles.createdAt), desc(articles.id))
    .limit(perPage)
    .offset(offset)

  const [{ total } = { total: 0 }] = await db
    .select({ total: count() })
    .from(articles)
    .where(whereClause)

  return { items, total }
}

/** The editor's row of article `id`, if it is inside `scope` (the handler's `articleActionScope(…, 'read')`). */
export async function findAdminArticle(id: number, scope: SQL) {
  const db = getDb()
  const [article] = await db
    .select({
      id:           articles.id,
      type:         articles.type,
      category:     articles.category,
      categoryId:   articles.categoryId,
      title:        articles.title,
      slug:         articles.slug,
      excerpt:      articles.excerpt,
      content:      articles.content,
      status:       articles.status,
      thumbnailUrl: articles.thumbnailUrl,
      publishedAt:  articles.publishedAt,
      createdAt:    articles.createdAt,
      updatedAt:    articles.updatedAt,
      authorName:   users.username,
    })
    .from(articles)
    .leftJoin(users, eq(articles.authorId, users.id))
    .where(and(eq(articles.id, id), scope))
    .limit(1)
  return article
}

/** The authors of the articles inside `scope` (`articleReadScope`), then the count of articles that lost theirs. */
export async function listArticleAuthors(scope: SQL) {
  const db = getDb()

  const items = await db
    .select({
      id:           users.id,
      username:     users.username,
      articleCount: count(articles.id),
    })
    .from(articles)
    .innerJoin(users, eq(articles.authorId, users.id))
    .where(scope)
    .groupBy(users.id, users.username)
    // Người đăng nhiều lên trước, vì đó là lựa chọn hay được dùng nhất; tên là
    // mốc phụ để thứ tự ổn định giữa hai lượt tải khi số bài bằng nhau.
    .orderBy(desc(count(articles.id)), asc(users.username))

  /**
   * Số bài đã mất tác giả. `articles.author_id` là `INT NULL` với
   * `ON DELETE SET NULL`, nên xoá một tài khoản là để lại đúng nhóm này. Trả về
   * đếm riêng để giao diện chỉ hiện tuỳ chọn "Không rõ tác giả" khi nhóm đó thật
   * sự có bài — một lựa chọn luôn cho ra danh sách rỗng thì không nên có mặt.
   */
  const [{ orphanCount } = { orphanCount: 0 }] = await db
    .select({ orphanCount: count() })
    .from(articles)
    .where(and(scope, isNull(articles.authorId)))

  return { items, orphanCount }
}

/** The four counts of the "Dịch toàn bộ" dialog, in their old order. */
export async function readTranslationStatsCounts() {
  const db = getDb()

  const [totalPublished] = await db
    .select({ total: sql<number>`count(*)` })
    .from(articles)
    .where(eq(articles.status, 'published'))

  const activeLangs = await db
    .select({ code: languages.code, name: languages.name, nativeName: languages.nativeName })
    .from(languages)
    .where(and(eq(languages.isActive, true), sql`${languages.code} != 'vi'`))

  const translationCounts = await db
    .select({
      langCode: articleTranslations.langCode,
      count: sql<number>`count(*)`,
    })
    .from(articleTranslations)
    .innerJoin(articles, eq(articleTranslations.articleId, articles.id))
    .where(and(
      eq(articles.status, 'published'),
      sql`${articleTranslations.status} != 'failed'`,
    ))
    .groupBy(articleTranslations.langCode)

  // Đếm bản dịch AI chưa xuất bản (ai_draft/reviewed) — để UI hiện badge trên
  // nút "Xuất bản toàn bộ". Bỏ qua translating/failed.
  const [aiPendingRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(articleTranslations)
    .where(and(
      eq(articleTranslations.translatedBy, 'ai'),
      sql`${articleTranslations.status} IN ('ai_draft','reviewed')`,
    ))

  return { totalPublished, activeLangs, translationCounts, aiPendingRow }
}

/** The article the bulk-translation job is on, if it is inside `scope` (`articleActionScope(…, 'read')`). */
export async function findVisibleArticleId(articleId: number, scope: SQL) {
  const db = getDb()
  const [visible] = await db
    .select({ id: articles.id })
    .from(articles)
    .where(and(eq(articles.id, articleId), scope))
    .limit(1)
  return visible
}

/** Translations still being written (`status = 'translating'`), any article. */
export async function countTranslatingTranslations() {
  const db = getDb()
  const [translatingRow] = await db
    .select({ count: count() })
    .from(articleTranslations)
    .where(eq(articleTranslations.status, 'translating'))
  return translatingRow
}

/** The stored row of the translation of article `id` into `lang` (the handler returns it unchanged, as before). */
export async function findArticleTranslation(id: number, lang: string) {
  const db = getDb()
  const [translation] = await db
    .select()
    .from(articleTranslations)
    .where(
      and(
        eq(articleTranslations.articleId, id),
        eq(articleTranslations.langCode, lang),
      ),
    )
    .limit(1)
  return translation
}
