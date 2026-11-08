/**
 * Read queries of the admin article exports, moved out of their handlers verbatim (2026-11-08: no
 * `server/api` file calls getDb() itself):
 *   - `GET /api/admin/articles/:id/export` ([id]/export.get.ts) — one article as HTML/Markdown;
 *   - `GET /api/admin/articles/export-batch` (export-batch.get.ts) — a ZIP of standalone HTML files;
 *   - `GET /api/admin/articles/export-csv` (export-csv.get.ts) — the list as CSV;
 *   - `POST /api/admin/articles/export-google` (export-google.post.ts) — Sheets + Docs.
 *
 * What stays in the handlers: the scope / WHERE clause (`articleActionScope` / `articleReadScope`
 * throw 403 themselves), the per-article `requireResourcePermission(read)` filter and its 403, the
 * CSV cells (`csvCell` — `= + - @` neutralised), the Việt Nam calendar dates (`vietnamDateString`),
 * the Google Drive link/OAuth checks, and the response headers. This file imports nothing but the
 * database and the schema — `tests/article-export-csv-injection.test.ts` replaces `services/articles`
 * with `articleReadScope` alone.
 */
import { and, desc, eq, inArray, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/mysql-core'
import { getDb } from '../utils/db'
import { articles, categories, users } from '../db/schema'

/** Article `id` with its author and category names, if it is inside `scope` (`articleActionScope(…, 'read')`). */
export async function findArticleForExport(id: number, scope: SQL) {
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
    .where(and(eq(articles.id, id), scope))
    .limit(1)
  return row
}

/** The articles `ids` for the ZIP export, newest first — the handler filters them by type permission. */
export async function findArticlesForBatchExport(ids: number[]) {
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
  return rows
}

/** At most `limit` rows of the list under `whereClause` (built by the handler), in the list's order. */
export async function listArticlesForCsvExport(whereClause: SQL, limit: number) {
  const db = getDb()
  const parentCategories = alias(categories, 'parentCategories')

  const items = await db
    .select({
      id: articles.id,
      type: articles.type,
      title: articles.title,
      slug: articles.slug,
      status: articles.status,
      categoryName: categories.name,
      authorName: users.username,
      // Displayed total (real + fabricated), the maintained column (wave2 design D6).
      viewTotal: articles.viewTotal,
      publishedAt: articles.publishedAt,
      createdAt: articles.createdAt,
    })
    .from(articles)
    .leftJoin(users, eq(articles.authorId, users.id))
    .leftJoin(categories, eq(articles.categoryId, categories.id))
    .leftJoin(parentCategories, eq(categories.parentId, parentCategories.id))
    .where(whereClause)
    // The list's order (index.get.ts), ties included: which rows the MAX_EXPORT cut keeps is defined.
    .orderBy(desc(articles.createdAt), desc(articles.id))
    .limit(limit)
  return items
}

/** The articles `ids` with author, category and thumbnail for the Google export — filtered by the handler. */
export async function findArticlesForGoogleExport(ids: number[]) {
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
  return rows
}
