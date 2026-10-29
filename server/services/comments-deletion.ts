/**
 * Every way a comment is removed: the single per-comment deletion path
 * (`deleteComment`), the impact count a ban or an account deletion shows before
 * it acts (`countReaderCommentImpact`), and the per-reader purge
 * (`deleteReaderComments`).
 *
 * Part of the comment service; `comments.ts` is its public entry point (a barrel)
 * and carries the decisions that hold across every sub-file. Kept in one file
 * because the invariant is "one deletion path" — the reply cascade, the audit
 * row and the "an administrator reply is not reader-deletable" rule live here
 * and nowhere else.
 */

import { eq, inArray } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { activityLogs, articleComments } from '../db/schema'

export type DeleteActor =
  | { kind: 'reader', readerId: number }
  | { kind: 'admin', userId: number }
  | { kind: 'system', reason: string }

export type DeleteCommentResult =
  | { ok: true, deleted: number }
  | { ok: false, statusCode: number, message: string }

/**
 * The single deletion path.
 *
 * Six callers share it — self-delete, admin delete, admin bulk delete, reader
 * ban, account deletion, and the retention purge — so that the audit row, the
 * reply cascade and the "an administrator reply is not reader-deletable" rule
 * exist in exactly one place. A second delete written next to one of those
 * callers is how one of the three quietly stops happening.
 *
 * Deleting a top-level comment takes its replies with it: the FK cascade on
 * `parentId` does that in the database (design.md D8), including administrator
 * replies, because a portal reply with nothing above it reads as an answer to a
 * question nobody asked.
 */
export async function deleteComment(params: { id: number, actor: DeleteActor }): Promise<DeleteCommentResult> {
  const db = getDb()

  const [row] = await db
    .select({
      id:          articleComments.id,
      articleId:   articleComments.articleId,
      mediaItemId: articleComments.mediaItemId,
      readerId:    articleComments.readerId,
      adminUserId: articleComments.adminUserId,
      parentId:    articleComments.parentId,
    })
    .from(articleComments)
    .where(eq(articleComments.id, params.id))
    .limit(1)

  if (!row) return { ok: false, statusCode: 404, message: 'Bình luận không tồn tại.' }

  if (params.actor.kind === 'reader') {
    if (row.adminUserId !== null) {
      return { ok: false, statusCode: 403, message: 'Không thể xoá phản hồi của Ban quản trị.' }
    }
    if (row.readerId !== params.actor.readerId) {
      return { ok: false, statusCode: 403, message: 'Bạn chỉ có thể xoá bình luận của chính mình.' }
    }
  }

  /**
   * Delete and audit in ONE transaction.
   *
   * Written as delete-then-log at first, which loses the pair the moment the
   * second statement fails: the comment is gone and nothing records who removed
   * it. On a government portal that is the exact loss the audit log exists to
   * prevent — a public statement disappears and the trail says it never happened.
   * The reverse order is no better (a log claiming a deletion that did not occur),
   * so the only correct answer is both or neither, which is what `banReader` and
   * `deleteReader` already do.
   */
  await db.transaction(async (tx) => {
    await tx.delete(articleComments).where(eq(articleComments.id, params.id))

    // A reader deleting their own comment writes no admin audit row: the actor is
    // a member of the public, `activityLogs.userId` is a FK to `users`, and there
    // is no officer to attribute it to.
    if (params.actor.kind === 'admin') {
      await tx.insert(activityLogs).values({
        userId:     params.actor.userId,
        action:     'delete',
        resource:   'article_comments',
        resourceId: params.id,
        // Both identifiers, so a removal is traceable to the item it was made on
        // whichever kind that was. `articleId` is null for a media comment and
        // vice versa — one of the two is always present, because a comment
        // cannot exist without a target.
        //
        // Ids only, never a slug or a URL: this row is an audit record, and the
        // audit `meta` never carries anything that could be pasted into a browser.
        meta:       { articleId: row.articleId, mediaItemId: row.mediaItemId, wasReply: row.parentId !== null },
      })
    }
  })

  return { ok: true, deleted: 1 }
}

/**
 * What a deletion is about to remove, in three separate numbers.
 *
 * `otherReaderReplies` exists because nothing restricts WHO may reply: reader B
 * can answer reader A's question. Deleting A therefore takes B's reply with it
 * through the parent_id cascade — and an earlier version of this counter only
 * reported `comments` + `adminReplies`, so a dialog could say "2" while four rows
 * disappeared. The whole reason this shape is returned instead of one total is
 * that an officer has to see what else goes; undercounting defeats that.
 */
export type ReaderCommentImpact = {
  /** Rows this reader authored (top-level comments and their own replies). */
  comments: number
  /** Administrator replies sitting under this reader's top-level comments. */
  adminReplies: number
  /** Replies by OTHER readers under this reader's top-level comments. */
  otherReaderReplies: number
}

/**
 * What reads and deletes a reader's comments: the pool, or a transaction the caller
 * already opened. Typed structurally rather than importing Drizzle's transaction
 * type, which is not exported in a usable shape here.
 */
type CommentDeleteExecutor = Pick<ReturnType<typeof getDb>, 'select' | 'delete'>

async function countImpact(readerId: number, executor?: CommentDeleteExecutor): Promise<{ impact: ReaderCommentImpact, topLevelIds: number[] }> {
  // Inside a transaction, on THAT transaction — never a second pool connection: with
  // one held per open transaction, ten bans at once took all ten connections and
  // waited for an eleventh forever, holding their row locks (verifier H2).
  const db = executor ?? getDb()

  const ownRows = db
    .select({ id: articleComments.id, parentId: articleComments.parentId })
    .from(articleComments)
    .where(eq(articleComments.readerId, readerId))
  // In a transaction the reader's own rows are read under FOR UPDATE, and first: the
  // count is of what THIS transaction will delete — a ban or purge that held them has
  // committed and they are gone — whatever the snapshot of a later plain read. New
  // replies cannot appear under X-locked parents, so the plain read below is exact.
  const owned = await (executor ? ownRows.for('update') : ownRows)

  const topLevelIds = owned.filter(row => row.parentId === null).map(row => row.id)

  let adminReplies = 0
  let otherReaderReplies = 0
  if (topLevelIds.length) {
    // Everything hanging off this reader's top-level comments, split by author.
    // Counted in one pass rather than two queries so the two numbers cannot be
    // read from different moments.
    const rows = await db
      .select({ id: articleComments.id, adminUserId: articleComments.adminUserId, readerId: articleComments.readerId })
      .from(articleComments)
      .where(inArray(articleComments.parentId, topLevelIds))

    for (const row of rows) {
      if (row.adminUserId !== null) adminReplies += 1
      // A reply authored by somebody else. `readerId === readerId` would be this
      // reader's own reply, which is already inside `owned`.
      else if (row.readerId !== readerId) otherReaderReplies += 1
    }
  }

  return { impact: { comments: owned.length, adminReplies, otherReaderReplies }, topLevelIds }
}

/**
 * What a ban or an account deletion is about to remove, measured *before*
 * anything is removed.
 *
 * The confirmation dialog has to name the administrator replies too: those are
 * the portal's own published answers, and they disappear with the questions they
 * sit under. An officer who is only told "3 bình luận" is agreeing to something
 * different from what happens.
 */
export async function countReaderCommentImpact(readerId: number, executor?: CommentDeleteExecutor): Promise<ReaderCommentImpact> {
  return (await countImpact(readerId, executor)).impact
}

/**
 * Removes every comment a reader wrote, and the administrator replies beneath
 * their top-level comments (design.md D8 — the `parentId` cascade).
 *
 * Returns the counts measured before the delete, because after it there is
 * nothing left to count and a successful purge would be indistinguishable from
 * one that never ran. With an `executor` (a transaction), counted on it under
 * FOR UPDATE — see `countImpact`; it used to count on the pool, a second
 * connection per open transaction (verifier H2).
 */
export async function deleteReaderComments(readerId: number, executor?: CommentDeleteExecutor): Promise<ReaderCommentImpact> {
  const { impact } = await countImpact(readerId, executor)
  if (impact.comments === 0) return impact

  // One statement: the FK cascade on parentId removes the replies, including the
  // administrator ones. Deleting replies separately first would leave a window
  // where a reply is gone but its question is still on the page.
  await (executor ?? getDb()).delete(articleComments).where(eq(articleComments.readerId, readerId))
  return impact
}
