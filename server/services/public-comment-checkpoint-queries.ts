/**
 * The query of `GET /api/public/comments/checkpoint` (`comments/checkpoint.get.ts`), moved out of
 * the handler verbatim. The handler keeps parsing and capping the ids and the reader session; an
 * anonymous caller never reaches this.
 *
 * A file of its own, importing only the database layer: the endpoint's suite
 * (tests/comment-checkpoint-privacy.test.ts) fakes `getDb` alone, and the comment-target lookups
 * beside it in `public-comments-queries.ts` load the media-portal barrel.
 */
import { and, eq, inArray } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { articleComments } from '../db/schema'

/**
 * `isHidden` of those of `ids` that `readerId` wrote — never `flagReason`, and never anyone
 * else's comment (walking ids used to harvest the moderation rules — rà soát 2026-10-22).
 */
export async function listOwnCommentVisibility(ids: number[], readerId: number) {
  const db = getDb()
  const rows = await db
    .select({
      id: articleComments.id,
      isHidden: articleComments.isHidden,
    })
    .from(articleComments)
    .where(and(inArray(articleComments.id, ids), eq(articleComments.readerId, readerId)))
  return rows
}
