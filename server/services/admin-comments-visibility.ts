/**
 * Hide or show one comment (`PATCH /api/admin/comments/:id/visibility`) — its read and its
 * write + audit transaction, moved out of the handler verbatim (2026-11-08: no `server/api` file
 * calls getDb() itself). The handler keeps the `comments.update` gate, the id/body parsing, the
 * 404 of the read and the "nothing to change" short-cut.
 *
 * Not part of the `comments-*` service family (its barrel and guards): this is the one direct
 * admin toggle of `is_hidden`, as the handler always had it.
 */
import { createError } from 'h3'
import { eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { articleComments, activityLogs } from '../db/schema'
import { readAffectedRows } from '../utils/affected-rows'

/** The comment's id and current visibility, if it exists. */
export async function findCommentVisibility(id: number) {
  const db = getDb()
  const [existing] = await db
    .select({ id: articleComments.id, isHidden: articleComments.isHidden })
    .from(articleComments)
    .where(eq(articleComments.id, Math.floor(id)))
    .limit(1)
  return existing
}

/**
 * Set `is_hidden` (and the hide reason) of comment `id` and write the audit row, in one
 * transaction; 404 (rolled back, nothing recorded) when the comment is gone by then.
 */
export async function setCommentVisibilityWithAudit(actorId: number | null, id: number, hidden: boolean, reason: string) {
  const db = getDb()
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(articleComments)
      .set({
        isHidden: hidden,
        flagReason: hidden ? (reason || null) : null,
      })
      .where(eq(articleComments.id, Math.floor(id)))
    // Counted (mysql2 reports MATCHED rows): a comment deleted since the read above — a ban, a
    // purge, another officer — is a 404, not a 200 with an audit row about a comment that is gone
    // (FINDING-R7-12, the R6-10 rule).
    if (readAffectedRows(updated) !== 1) {
      throw createError({ statusCode: 404, statusMessage: 'Bình luận không tồn tại.' })
    }

    await tx.insert(activityLogs).values({
      userId: actorId,
      action: 'update',
      resource: 'comments',
      resourceId: Math.floor(id),
      meta: { visibility: hidden ? 'hidden' : 'visible', reason: hidden ? reason : null },
    })
  })
}
