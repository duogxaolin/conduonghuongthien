/**
 * The caller's own comments, for the profile page.
 *
 * There is no `readerId` parameter and no way to express one — the identity comes
 * from the ticket. This is a list of one citizen's public statements with the
 * article each one sits under, which is precisely the shape of query that must not
 * be aimable at somebody else.
 *
 * NOT audited, deliberately. The rule that every read of reader data writes an
 * `activity_logs` row (design.md D14) targets OFFICERS reading citizens' data: a
 * log of personal data that can be browsed without leaving a trace is a
 * surveillance tool. A reader opening their own page is not that, and logging it
 * would bury the rows the table exists for under one line per page view — the same
 * reasoning that keeps `checkPermission` off /admin/profile.
 *
 * Never SSR-rendered: article routes are SWR-cached and /nguoi-doc is not in
 * routeRules at all, so this is fetched after mount like every other
 * reader-specific response.
 */
import { desc, eq, sql } from 'drizzle-orm'

import { getDb } from '../../../utils/db'
import { articleComments, articles } from '../../../db/schema'
import { requireReader } from '../../../utils/reader-auth'

/** Server-enforced ceiling. A client-supplied page size is a request. */
const MAX_PER_PAGE = 20
const DEFAULT_PER_PAGE = 10

/**
 * Finite first, THEN clamped.
 *
 * `Math.max(1, Number('abc'))` is NaN — every comparison with NaN is false, so the
 * clamp passes it straight through into `.offset()` and serialises as `page:
 * null`: rows returned while claiming to be on no page at all. `?page=1e999` gets
 * through the same hole. This is the bug /tai-lieu-hoi-dap already hit once.
 */
function finitePositive(raw: unknown, fallback: number, max: number): number {
  const value = Number(raw)
  if (!Number.isFinite(value)) return fallback
  return Math.min(Math.max(1, Math.floor(value)), max)
}

export default defineEventHandler(async (event) => {
  const reader = await requireReader(event)
  const query = getQuery(event)

  const perPage = finitePositive(query.perPage, DEFAULT_PER_PAGE, MAX_PER_PAGE)
  const db = getDb()

  const where = eq(articleComments.readerId, reader.id)

  const [countRow] = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(articleComments)
    .where(where)

  const total = Number(countRow?.total ?? 0)
  const totalPages = Math.max(1, Math.ceil(total / perPage))
  const page = Math.min(finitePositive(query.page, 1, 100_000), totalPages)

  const rows = await db
    .select({
      id:           articleComments.id,
      body:         articleComments.body,
      createdAt:    articleComments.createdAt,
      parentId:     articleComments.parentId,
      articleTitle: articles.title,
      articleSlug:  articles.slug,
      articleStatus: articles.status,
      commentsEnabled: articles.commentsEnabled,
      // How many replies sit under this comment. The one-level rule means this is
      // a count, not a tree — a reader wants to know whether the portal answered,
      // and inlining the replies would put administrator text on a page whose
      // whole job is showing the reader their own words.
      replyCount: sql<number>`(SELECT COUNT(*) FROM \`article_comments\` \`r\` WHERE \`r\`.\`parent_id\` = \`article_comments\`.\`id\`)`,
    })
    .from(articleComments)
    .leftJoin(articles, eq(articleComments.articleId, articles.id))
    .where(where)
    .orderBy(desc(articleComments.createdAt), desc(articleComments.id))
    .limit(perPage)
    .offset((page - 1) * perPage)

  return {
    ok: true,
    total,
    page,
    perPage,
    totalPages,
    comments: rows.map(row => ({
      id:        row.id,
      body:      row.body,
      createdAt: row.createdAt ? row.createdAt.toISOString() : null,
      isReply:   row.parentId !== null,
      replyCount: Number(row.replyCount ?? 0),
      article: row.articleSlug === null ? null : {
        title: row.articleTitle,
        slug:  row.articleSlug,
        /**
         * Whether following the link actually reaches the comment.
         *
         * A comment survives its article being unpublished or having comments
         * turned off (turning them off hides the thread, it never deletes rows —
         * design.md D10). Handing over a link that silently shows no thread would
         * read as the comment having been removed, so the page says so instead.
         */
        readable: row.articleStatus === 'published' && row.commentsEnabled === true,
        // `/news/<slug>` is the URL, whatever the article's type is.
        //
        // NOT derived from the type: /news/[id].vue looks an article up by slug
        // with no type filter, so it renders every type — and it is the only
        // detail route that does. /documents and /legal-qa have an index page and
        // NO detail page at all, so a per-type prefix would hand a reader a 404
        // for exactly the comments they left on a legal document, and they would
        // read that as the portal having deleted what they wrote.
        url: `/news/${row.articleSlug}`,
      },
    })),
  }
})
