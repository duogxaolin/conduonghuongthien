/**
 * The portal answering in public: an officer's reply under the fixed
 * "Ban quản trị" label, written with its audit row and the reader notification
 * in one transaction, and mailed after the commit.
 *
 * Part of the comment service; `comments.ts` is its public entry point (a barrel)
 * and carries the decisions that hold across every sub-file.
 */

import { eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { getDb } from '../utils/db'
import { activityLogs, articleComments } from '../db/schema'
import { createReplyNotification } from './notifications'
import { sendReplyEmail } from './notification-email'
import { checkParentEligibility, resolveCommentTarget } from './comments-rules'

export type AdminReplyResult =
  | { ok: true, id: number }
  | { ok: false, statusCode: number, message: string }

/**
 * The portal replying in public, under the fixed "Ban quản trị" label.
 *
 * Two rules that differ from a reader's write, both deliberate:
 *
 *   1. **Allowed on a closed thread.** Closing comments stops the public from
 *      posting, not the portal from answering. An officer who closes a thread to
 *      stop an argument still has to be able to post the correct information
 *      under it.
 *   2. **No rate limit.** The limits exist to bound anonymous public writes; an
 *      authenticated officer is already accountable through the audit row.
 *
 * The one-level rule still holds, through the same pure `checkParentEligibility`
 * the reader path uses — an official reply nested under another reply would break
 * the two-pass read and render nowhere.
 */
export async function createAdminReply(params: {
  parentId: number
  body:     string
  actorId:  number
  ip:       string | null
  userAgent: string | null
  event:    H3Event
}): Promise<AdminReplyResult> {
  const db = getDb()

  const [parent] = await db
    .select({
      id:          articleComments.id,
      articleId:   articleComments.articleId,
      mediaItemId: articleComments.mediaItemId,
      parentId:    articleComments.parentId,
    })
    .from(articleComments)
    .where(eq(articleComments.id, params.parentId))
    .limit(1)

  if (!parent) return { ok: false, statusCode: 404, message: 'Bình luận gốc không tồn tại.' }

  /**
   * The reply inherits the parent's item, resolved through the same XOR guard the
   * reader path uses rather than by reading `parent.articleId` directly.
   *
   * Reading the column directly would be the bug: a media comment has
   * `articleId === null`, so an officer replying under a video would insert a
   * row with neither identifier — a comment in no thread at all, invisible on
   * every page and reachable only from the moderation list. The guard turns that
   * into a refusal instead of a silent orphan.
   */
  const resolved = resolveCommentTarget(parent.articleId, parent.mediaItemId)
  if (!resolved.ok) return { ok: false, statusCode: 409, message: 'Bình luận gốc không thuộc nội dung nào.' }
  const target = resolved.target

  const verdict = checkParentEligibility(parent, target)
  if (!verdict.ok) return { ok: false, statusCode: 400, message: verdict.message }

  // Reply and audit row commit together: a reply that exists with no logged
  // record of which admin posted it is the same unaccountable gap deleteComment
  // (comments-deletion.ts) guards against, just on the write side instead of the
  // delete side.
  let id = 0
  let notifiedReaderId: number | null = null
  await db.transaction(async (tx) => {
    const inserted = await tx.insert(articleComments).values({
      articleId:   target.kind === 'article' ? target.articleId : null,
      mediaItemId: target.kind === 'media' ? target.mediaItemId : null,
      readerId:    null,
      adminUserId: params.actorId,
      parentId:    parent.id,
      body:        params.body,
      ip:          params.ip,
      userAgent:   (params.userAgent || '').slice(0, 512) || null,
      // Drizzle query builder, never pool.query — design.md D17.
      createdAt:   new Date(),
    })

    // Destructured for the reason given at the same step in createComment
    // (db.insert() resolves to [ResultSetHeader, FieldPacket[]]) — and here the
    // cost of getting it wrong is the concrete one: `resourceId: 0` on the audit
    // row below, an official reply in force whose audit entry points at no row.
    // Exactly what wrapping these two writes in a transaction exists to prevent.
    const [header] = inserted
    id = Number(header?.insertId ?? 0)

    await tx.insert(activityLogs).values({
      userId:     params.actorId,
      action:     'create',
      resource:   'comments',
      resourceId: id,
      // Both identifiers, mirroring deleteComment's audit row: the removal and the
      // creation of an official reply are the same fact seen twice, and a trace
      // that names the item on one side but not the other is a trace an officer
      // cannot follow end to end.
      meta:       {
        operation:   'admin_reply',
        articleId:   target.kind === 'article' ? target.articleId : null,
        mediaItemId: target.kind === 'media' ? target.mediaItemId : null,
        parentId:    parent.id,
      },
    })

    // The portal answering is the notification that matters most: it is the
    // official reply the citizen has been waiting for. `actorReaderId: null`
    // because the author is an officer, not a reader — so the self-reply guard
    // never suppresses it.
    notifiedReaderId = await createReplyNotification({
      commentId:     id,
      parentId:      parent.id,
      actorReaderId: null,
      tx,
    })
  })

  // After the commit, never inside it — an unreachable SMTP host must not hold
  // this reply's row locks open for a network timeout. See createComment.
  if (notifiedReaderId !== null) {
    await sendReplyEmail({ commentId: id, parentId: parent.id, recipientId: notifiedReaderId, event: params.event })
  }

  return { ok: true, id }
}
