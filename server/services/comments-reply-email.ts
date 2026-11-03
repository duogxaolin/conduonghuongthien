/**
 * The reply e-mail's hold policy: given the full (AI) moderation verdict on a
 * reader's reply, may the parent's author be mailed — and if not, how the hold is
 * logged (`comment.reply_email_held`).
 *
 * Part of the comment service; `comments.ts` is its public entry point (a barrel).
 * Only the POLICY lives here. The ordering — mail only after the comment's
 * transaction commits, only after the verdict, behind the response — stays
 * inline in `createComment` (comments-posting.ts), next to the transaction it is
 * ordered against, because that is where the guard in
 * `tests/media-comments.test.ts` checks that `sendReplyEmail` sits outside the
 * transaction callback. Nothing here is part of the barrel's public API.
 */

import type { ModerationCheckOutput } from './moderation-worker'
import { logInfo, logWarn } from '../utils/logger'

type ReplyEmailHold = 'moderation_hidden' | 'moderation_ai_failed' | 'moderation_error'

/** `comment.reply_email_held`: info for a moderation decision, warn for a moderation that did not complete. */
export function logReplyEmailHeld(reply: { commentId: number, parentId: number }, hold: ReplyEmailHold, verdict: ModerationVerdict): void {
  const fields = {
    event: 'comment.reply_email_held',
    commentId: reply.commentId,
    parentId: reply.parentId,
    reason: hold,
    ...(hold === 'moderation_ai_failed' && typeof verdict === 'object' ? { aiFailure: verdict.aiFailure } : {}),
  }
  if (hold === 'moderation_hidden') logInfo(fields)
  else logWarn(fields)
}

export const MODERATION_FAILED = Symbol('moderation-failed')
export type ModerationFailure = typeof MODERATION_FAILED
export type ModerationVerdict = ModerationCheckOutput | ModerationFailure

/**
 * `null` = the e-mail may go. Held on the VERDICT (`auto_hide`/`block`), not on
 * whether hiding the row succeeded: a hide write that failed leaves the reply on
 * the page, but it is still a reply moderation refused. Held too when the AI was
 * asked and never judged the reply (`aiFailed`, e.g. provider error): its
 * "allow" then only means "no critical keyword", not a completed moderation.
 * `flag_only` (queued for a human, left visible — the "AI not configured" path)
 * is neither hidden nor blocked, so it is mailed.
 */
export function replyEmailHoldReason(verdict: ModerationVerdict): ReplyEmailHold | null {
  if (verdict === MODERATION_FAILED) return 'moderation_error'
  if (verdict.flagged && (verdict.action === 'auto_hide' || verdict.action === 'block')) return 'moderation_hidden'
  if (verdict.aiFailed) return 'moderation_ai_failed'
  return null
}
