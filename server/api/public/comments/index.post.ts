/**
 * Posts one comment or one reply.
 *
 * Everything that decides whether the write may happen lives in
 * `createComment` — article published, comments open, reader not banned, address
 * not banned, parent eligible, then both rate limits charged immediately before
 * the insert. Keeping it there rather than here is what lets the ordering be
 * tested, and what stops a second write path from being added later with three
 * of the six checks.
 *
 * The body is stored verbatim, never sanitised (design.md D12): the public
 * component renders it through `{{ }}`, so HTML is never interpreted and there is
 * nothing to strip. Sanitising would rewrite what a citizen wrote — angle
 * brackets in a quoted regulation, an ampersand in an office name — and show them
 * words they did not type.
 */
import { and, eq } from 'drizzle-orm'

import { getDb } from '../../../utils/db'
import { articles } from '../../../db/schema'
import { requireReader, touchReader } from '../../../utils/reader-auth'
import { createComment, validateBody } from '../../../services/comments'
import { getClientIp } from '../../../utils/client-ip'

export default defineEventHandler(async (event) => {
  // Throws 401 when signed out, 403 when banned. The UI needs those apart: for
  // 401 it reopens the Google flow, for 403 it must not — signing in again would
  // succeed and change nothing, which reads as the portal being broken.
  const reader = await requireReader(event)

  const body = await readBody(event).catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Dữ liệu không hợp lệ.' })
  }

  const { articleSlug, parentId, body: rawBody } = body as Record<string, unknown>

  const slug = typeof articleSlug === 'string' ? articleSlug.trim() : ''
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'Thiếu bài viết.' })

  const validation = validateBody(rawBody)
  if (!validation.ok) throw createError({ statusCode: 400, statusMessage: validation.message })

  let parent: number | null = null
  if (parentId !== undefined && parentId !== null) {
    const value = Number(parentId)
    if (!Number.isFinite(value) || value <= 0) {
      throw createError({ statusCode: 400, statusMessage: 'Bình luận gốc không hợp lệ.' })
    }
    parent = Math.floor(value)
  }

  // The slug → id lookup is here rather than in the service so the service takes
  // an article id and stays independent of how the caller identified it.
  const [article] = await getDb()
    .select({ id: articles.id })
    .from(articles)
    .where(and(eq(articles.slug, slug), eq(articles.status, 'published')))
    .limit(1)

  if (!article) throw createError({ statusCode: 404, statusMessage: 'Bài viết không tồn tại.' })

  const result = await createComment({
    readerId:  reader.id,
    articleId: article.id,
    parentId:  parent,
    body:      validation.body,
    ip:        getClientIp(event),
    userAgent: getRequestHeader(event, 'user-agent') || null,
  })

  if (!result.ok) {
    if (result.retryAfterSeconds) setResponseHeader(event, 'retry-after', result.retryAfterSeconds)
    throw createError({ statusCode: result.statusCode, statusMessage: result.message })
  }

  /**
   * Stamp `last_seen_at` on a successful write.
   *
   * This is not cosmetic bookkeeping: `last_seen_at` is the column the retention
   * scope ages accounts against (design.md D16). Without a stamp on the actions a
   * reader actually takes, the only writer would be the OAuth callback — and a
   * reader ticket lives 30 days, so somebody who signs in once and then comments
   * every week for a year would carry a `last_seen_at` frozen at their first
   * sign-in. Their account would age out on a 365-day window while they were
   * still posting, and the purge would take every comment they had written with
   * it. Posting a comment is the least ambiguous evidence an account is live.
   *
   * Deliberately AFTER the write and not awaited for correctness: touchReader
   * swallows its own errors, so a failed stamp cannot turn a comment that was
   * successfully stored into an error the reader sees.
   */
  await touchReader(event, reader.id)

  setResponseStatus(event, 201)
  return { ok: true, id: result.id }
})
