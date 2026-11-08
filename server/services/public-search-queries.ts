/**
 * Queries of the portal-wide search (`GET /api/public/search`, `search.get.ts`), moved out of the
 * handler verbatim: the three `COUNT(*)` (articles by type, published Q&A, pages) issued together,
 * then one read per slice of the page — articles, Q&A, pages.
 *
 * Every function takes the SAME `pattern` the handler built once with `containsPattern` (the
 * visitor's `%`, `_` and `\` escaped), so a count and the rows it pages over cannot disagree on
 * the condition. The handler keeps reading and clamping the query, the empty-query answer, the
 * slice plan (`planSearchSlices`), the projection of every row into a `SearchItem` (labels,
 * badges, URLs, `plainTextField`) and `reportPublicReadFailure()` (503 + `no-store`).
 */
import { and, asc, count, desc, eq, inArray, like, or, type SQL } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { REINTEGRATION_TYPES, type SearchFilter } from '../utils/search-paging'
import { articles, categories, chatbotKnowledge, pages } from '../db/schema'

/** Published articles whose title or excerpt contains the pattern. */
function articleMatch(pattern: string) {
  return and(
    eq(articles.status, 'published'),
    or(like(articles.title, pattern), like(articles.excerpt, pattern)),
  )
}

/** Published Q&A entries whose question or approved answer contains the pattern. */
function qaMatch(pattern: string) {
  return and(
    eq(chatbotKnowledge.status, 'published'),
    or(like(chatbotKnowledge.canonicalQuestion, pattern), like(chatbotKnowledge.approvedAnswer, pattern)),
  )
}

/** Pages whose title or slug contains the pattern. */
function pageMatch(pattern: string) {
  return or(like(pages.title, pattern), like(pages.slug, pattern))
}

/** Lọc loại bài khi tab là một loại bài cụ thể; `all` không lọc loại. */
function articleTypeCondition(filter: SearchFilter): SQL | undefined {
  if (filter === 'reintegration_model') return inArray(articles.type, [...REINTEGRATION_TYPES])
  if (filter === 'news' || filter === 'role_model' || filter === 'document' || filter === 'faq') return eq(articles.type, filter)
  return undefined
}

/** The counts of every tab: article matches grouped by type, Q&A matches, page matches — three statements issued together. */
export async function countSearchMatches(pattern: string) {
  const db = getDb()

  const [articleTypeRows, qaTotalRows, pageTotalRows] = await Promise.all([
    db.select({ type: articles.type, total: count() }).from(articles).where(articleMatch(pattern)).groupBy(articles.type),
    db.select({ total: count() }).from(chatbotKnowledge).where(qaMatch(pattern)),
    db.select({ total: count() }).from(pages).where(pageMatch(pattern)),
  ])

  return { articleTypeRows, qaTotalRows, pageTotalRows }
}

/** One slice of the matching articles (restricted to the tab's type, if any), newest published first. */
export async function listSearchArticleRows(pattern: string, filter: SearchFilter, limit: number, offset: number) {
  const db = getDb()
  const typeCondition = articleTypeCondition(filter)

  const rows = await db
    .select({
      id: articles.id,
      type: articles.type,
      title: articles.title,
      slug: articles.slug,
      excerpt: articles.excerpt,
      thumbnailUrl: articles.thumbnailUrl,
      publishedAt: articles.publishedAt,
      createdAt: articles.createdAt,
      categoryName: categories.name,
    })
    .from(articles)
    .leftJoin(categories, eq(articles.categoryId, categories.id))
    .where(typeCondition ? and(articleMatch(pattern), typeCondition) : articleMatch(pattern))
    .orderBy(desc(articles.publishedAt), desc(articles.id))
    .limit(limit)
    .offset(offset)

  return rows
}

/** One slice of the matching published Q&A entries, newest id first. */
export async function listSearchQaRows(pattern: string, limit: number, offset: number) {
  const db = getDb()

  const rows = await db
    .select({
      id: chatbotKnowledge.id,
      canonicalQuestion: chatbotKnowledge.canonicalQuestion,
      approvedAnswer: chatbotKnowledge.approvedAnswer,
      topic: chatbotKnowledge.topic,
      publishedAt: chatbotKnowledge.publishedAt,
      createdAt: chatbotKnowledge.createdAt,
    })
    .from(chatbotKnowledge)
    .where(qaMatch(pattern))
    .orderBy(desc(chatbotKnowledge.id))
    .limit(limit)
    .offset(offset)

  return rows
}

/** One slice of the matching pages, by id. */
export async function listSearchPageRows(pattern: string, limit: number, offset: number) {
  const db = getDb()

  const rows = await db
    .select({
      id: pages.id,
      title: pages.title,
      slug: pages.slug,
      seoDescription: pages.seoDescription,
    })
    .from(pages)
    .where(pageMatch(pattern))
    // Thứ tự xác định — không có ORDER BY thì OFFSET trả hàng tuỳ ý giữa hai lượt.
    .orderBy(asc(pages.id))
    .limit(limit)
    .offset(offset)

  return rows
}
