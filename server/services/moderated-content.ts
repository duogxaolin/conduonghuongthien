/**
 * What resolving a row of the AI moderation queue does to the content it is about
 * (`POST /api/admin/ai/moderation/queue/:id/resolve`). Runs inside the handler's transaction,
 * before its conditional queue UPDATE and its audit row: a resolve that loses the row to another
 * officer (409) rolls back everything here with it.
 *
 * ## "Bỏ ẩn" shows again only what THIS row's automatic hide still hides
 *
 * The hide source is `flag_reason`: the automatic hide (`applyAutoHide`) writes the queue row's
 * own reason (`autoHideFlagReason`); an officer's hide writes their reason or NULL
 * (`comments/[id]/visibility.patch.ts`), an officer's removal of a livestream message writes none
 * (`removeChatMessage`). So an approve restores the target only when, at once:
 *   - the row was still `pending` when read — an approve of a row already resolved (the server
 *     accepts it, owner's call) never shows anything;
 *   - the target still exists — a reject, a ban (it deletes the reader's comments), a purge or
 *     retention took it: `gone`;
 *   - it is hidden, and its `flag_reason` is exactly this row's — an officer hid it (before the
 *     automatic hide, which then writes nothing, or since), or an officer showed it and another
 *     automatic hide filed under another reason hid it again: `not_restored`;
 *   - (livestream) its author is not banned — a ban does not touch livestream messages, so the
 *     restore itself must not put a banned reader's words back on screen.
 * The target is read first with a plain (non-locking) read, then changed by a conditional UPDATE
 * on its primary key that re-checks the same state: the read only classifies, the UPDATE decides.
 *
 * Not restorable, by construction: chatbot turns (a refused question is answered with a refusal
 * and stored as such, nothing is hidden — `recordInstantBlock` files no target), the gates that
 * refuse a comment or a livestream message before it is saved (nothing stored), queue rows filed
 * before instant blocks carried their target, and livestream messages hidden before
 * `livestream_messages.flag_reason` existed (no mark: indistinguishable from an officer's removal).
 *
 * ## A reject or a ban of an APPROVED livestream row takes the message down again
 *
 * The queue page offers "Xóa" on an approved row. For a comment that deletes it; a livestream
 * message is never deleted, only marked (`livestream-chat.ts`), so a reject/ban of a row read as
 * `approved` marks the message removed again — with no `flag_reason`, an officer's removal —
 * undoing what the approve showed. Any other row keeps the base's behaviour: nothing is written
 * to the message (a pending row's message is already hidden — or, for an AI `flag_only` verdict,
 * was never hidden, and the base left it so; KNOWN, owner's brief: "reject unchanged").
 *
 * Live viewers are told after the commit (`announceToLiveViewers`), never from inside the
 * transaction: a broadcast cannot roll back.
 */
import { and, eq } from 'drizzle-orm'
import { articleComments, livestreamMessages, readerAccounts, type AiModerationQueueItem } from '../db/schema'
import { readAffectedRows } from '../utils/affected-rows'
import type { Database } from '../utils/db'
import { autoHideFlagReason } from '../utils/moderation-flag-reason'
import { broadcastToSession, SSE_EVENT_MESSAGE, SSE_EVENT_REMOVAL } from '../utils/sse-manager'
import { CHAT_MESSAGE_COLUMNS, serializeChatMessage, type ChatMessage } from './livestream-chat'

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]
type QueueTarget = Pick<AiModerationQueueItem, 'targetType' | 'targetId' | 'flaggedReason' | 'status'>

/** What an approve did to the content (`restore` in the answer and in the audit row). */
export type RestoreOutcome =
  /** Shown again by this approve. */
  | 'restored'
  /** Already showing — nothing to undo. */
  | 'visible'
  /** Hidden, but not (or no longer) by this row's automatic hide: kept hidden. */
  | 'not_restored'
  /** The content row no longer exists. */
  | 'gone'
  /** Nothing this row could have hidden, or the row was no longer pending. */
  | 'not_applicable'

/** What live viewers of a broadcast must be told once the transaction committed. */
export type LivestreamAnnouncement =
  | { kind: 'shown', sessionId: number, message: ChatMessage }
  | { kind: 'removed', sessionId: number, messageId: number }

export interface RestoreResult {
  outcome: RestoreOutcome
  announce: LivestreamAnnouncement | null
}

function counted(result: unknown, what: string): number {
  const changed = readAffectedRows(result)
  // Not knowing whether the row changed is not a restore: roll back rather than report one.
  if (changed === null) throw new Error(`moderation resolve: could not read affectedRows from the ${what} UPDATE`)
  return changed
}

/** Approve: undo this queue row's automatic hide, when that hide is still what hides the target. */
export async function restoreAutoHidden(tx: Tx, item: QueueTarget): Promise<RestoreResult> {
  const none = (outcome: RestoreOutcome): RestoreResult => ({ outcome, announce: null })
  const targetId = item.targetId
  if (item.status !== 'pending' || !targetId) return none('not_applicable')
  const mark = autoHideFlagReason(item.flaggedReason)

  if (item.targetType === 'comment') {
    const [row] = await tx
      .select({ isHidden: articleComments.isHidden, flagReason: articleComments.flagReason })
      .from(articleComments)
      .where(eq(articleComments.id, targetId))
      .limit(1)
    if (!row) return none('gone')
    if (!row.isHidden) return none('visible')
    if (row.flagReason !== mark) return none('not_restored')
    const changed = counted(await tx
      .update(articleComments)
      .set({ isHidden: false, flagReason: null })
      .where(and(eq(articleComments.id, targetId), eq(articleComments.isHidden, true), eq(articleComments.flagReason, mark))), 'comment')
    return none(changed === 1 ? 'restored' : 'not_restored')
  }

  if (item.targetType === 'livestream_chat') {
    const [row] = await tx
      .select({
        // The columns the message goes out with — its name resolved by `serializeChatMessage`.
        ...CHAT_MESSAGE_COLUMNS,
        sessionId: livestreamMessages.sessionId,
        isDeleted: livestreamMessages.isDeleted,
        flagReason: livestreamMessages.flagReason,
        authorBanned: readerAccounts.isBanned,
      })
      .from(livestreamMessages)
      .leftJoin(readerAccounts, eq(readerAccounts.id, livestreamMessages.readerId))
      .where(eq(livestreamMessages.id, targetId))
      .limit(1)
    if (!row) return none('gone')
    if (!row.isDeleted) return none('visible')
    if (row.flagReason !== mark || row.authorBanned) return none('not_restored')
    const changed = counted(await tx
      .update(livestreamMessages)
      .set({ isDeleted: false, flagReason: null })
      .where(and(eq(livestreamMessages.id, targetId), eq(livestreamMessages.isDeleted, true), eq(livestreamMessages.flagReason, mark))), 'livestream message')
    if (changed !== 1) return none('not_restored')
    return { outcome: 'restored', announce: { kind: 'shown', sessionId: row.sessionId, message: serializeChatMessage(row) } }
  }

  // 'chat' (a refused chatbot turn: stored as asked, nothing hidden), 'article', anything else.
  return none('not_applicable')
}

/** Reject / ban of an approved livestream row: the message the approve put back is removed again. */
export async function withdrawLivestreamMessage(tx: Tx, item: Pick<QueueTarget, 'targetType' | 'targetId' | 'status'>): Promise<LivestreamAnnouncement | null> {
  const targetId = item.targetId
  if (item.targetType !== 'livestream_chat' || !targetId || item.status !== 'approved') return null
  const [row] = await tx
    .select({ sessionId: livestreamMessages.sessionId, isDeleted: livestreamMessages.isDeleted })
    .from(livestreamMessages)
    .where(eq(livestreamMessages.id, targetId))
    .limit(1)
  if (!row || row.isDeleted) return null
  const changed = counted(await tx
    .update(livestreamMessages)
    .set({ isDeleted: true, flagReason: null })
    .where(and(eq(livestreamMessages.id, targetId), eq(livestreamMessages.isDeleted, false))), 'livestream message')
  return changed === 1 ? { kind: 'removed', sessionId: row.sessionId, messageId: targetId } : null
}

/** After the commit: the restored message appears in place (the client merges by id, sorts by time), a removed one goes. */
export function announceToLiveViewers(announce: LivestreamAnnouncement | null): void {
  if (!announce) return
  if (announce.kind === 'shown') {
    broadcastToSession(announce.sessionId, { event: SSE_EVENT_MESSAGE, data: JSON.stringify(announce.message) })
  } else {
    broadcastToSession(announce.sessionId, { event: SSE_EVENT_REMOVAL, data: JSON.stringify({ id: announce.messageId }) })
  }
}
