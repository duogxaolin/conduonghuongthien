/**
 * One page of a comment thread, by article slug.
 *
 * Called from the browser after mount, never during SSR — the article routes are
 * SWR-cached (design.md constraint 1), and this response depends on who is
 * asking: `canDelete` differs per reader. A cached copy of it would show one
 * visitor delete buttons on another visitor's comments.
 *
 * An unknown slug, an unpublished article and a closed thread all return an
 * empty thread with `enabled: false` rather than a 404. The component renders
 * nothing in that case, and a status code that varied by slug would let this
 * endpoint be used to enumerate unpublished articles.
 */
import { and, eq } from 'drizzle-orm'

import { getDb } from '../../../utils/db'
import { articles } from '../../../db/schema'
import { optionalReader } from '../../../utils/reader-auth'
import { COMMENT_MAX_PER_PAGE, loadCommentThread } from '../../../services/comments'

/** Small enough to keep the first paint quick, large enough that most threads
 *  fit on one page. */
const DEFAULT_PER_PAGE = 20

/**
 * A query number is finite or it is the default — never `Math.max(1, Number(x))`.
 *
 * `Number('abc')` is NaN, every comparison with NaN is false, so a clamp written
 * that way passes NaN straight through into `.offset()` and serialises as
 * `page: null`: the endpoint returns rows while claiming to be on no page at all.
 * `?page=1e999` (Infinity) gets through the same hole. This is the bug the
 * /tai-lieu-hoi-dap work already hit once; the check has to come BEFORE the clamp.
 */
function finitePositive(raw: unknown, fallback: number, max: number): number {
  const value = Number(raw)
  if (!Number.isFinite(value)) return fallback
  return Math.min(Math.max(1, Math.floor(value)), max)
}

const EMPTY = { comments: [], total: 0, totalPages: 1 }

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'articleSlug')
  const query = getQuery(event)

  const page = finitePositive(query.page, 1, 100_000)
  const perPage = finitePositive(query.perPage, DEFAULT_PER_PAGE, COMMENT_MAX_PER_PAGE)

  if (!slug) return { ok: true, enabled: false, page, perPage, ...EMPTY }

  const [article] = await getDb()
    .select({ id: articles.id, commentsEnabled: articles.commentsEnabled })
    .from(articles)
    .where(and(eq(articles.slug, slug), eq(articles.status, 'published')))
    .limit(1)

  if (!article) return { ok: true, enabled: false, page, perPage, ...EMPTY }

  // Turning comments off hides the thread; it never deletes it (design.md D10).
  // The rows are still there and administrators still see them in moderation.
  if (!article.commentsEnabled) return { ok: true, enabled: false, page, perPage, ...EMPTY }

  const reader = await optionalReader(event)
  const thread = await loadCommentThread({
    articleId:      article.id,
    page,
    perPage,
    viewerReaderId: reader?.id ?? null,
  })

  return { ok: true, enabled: true, signedIn: reader !== null, ...thread }
})
