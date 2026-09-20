/**
 * Retention policy for the operational tables — the ones holding personal data
 * that analytics maintenance never touched.
 *
 * `activity_logs` gains a row on every login and every create/update/delete,
 * and its `meta` column carries the caller's IP and User-Agent.
 * `submissions` holds what citizens type into the public forms: full name,
 * phone, email, address, free-text message.
 * `chat_sessions` holds chatbot conversations with IP, user-agent, and detected
 * contact info (phone, name).
 *
 * All were kept forever (chat sessions added in 2026-08). A default of "forever"
 * is a decision nobody made, so these values make it explicit and configurable.
 *
 * `0` means "keep indefinitely" and disables the purge for that table. It is
 * the default for `submissions` on purpose: a public authority's records
 * schedule decides how long citizen correspondence is held, and this code is
 * not the place to guess it. Set SUBMISSION_RETENTION_DAYS once that schedule
 * is known.
 *
 * Chat sessions default to 90 days: enough to correlate a conversation with a
 * later submission, but short enough that casual browsing history does not
 * accumulate indefinitely. `chat_messages` has no window of its own — its FK
 * cascades from `chat_sessions`, so the transcript goes with the conversation.
 *
 * `reader_accounts` holds a Google identity (the provider's subject id, email,
 * display name) plus the last IP and User-Agent seen. One year is the same
 * window the audit trail uses, and it is measured against `last_seen_at`, not
 * `created_at`: an account opened three years ago that commented yesterday is a
 * live reader, and deleting it would take their comments with it. Like
 * `chat_messages`, `article_comments` has no window of its own — its FKs cascade
 * from both `reader_accounts` and `articles`, so a comment (and any reply under
 * it) goes with whichever parent is purged.
 *
 * `livestream_sessions` holds a broadcast plus the chat its viewers typed, and
 * is measured against `ended_at`. `livestream_messages` has no window of its
 * own, for the third time and the same reason: its FK cascades from the session,
 * so a message window would delete messages out of a session that is still
 * listed, and a message row cap would cut a live conversation in half.
 */

export const DATA_RETENTION_DEFAULTS = {
  /** Audit trail. One year covers the usual review window without hoarding IPs. */
  activityLogDays: 365,
  /** 0 = disabled. Enable deliberately, per the agency's records schedule. */
  submissionDays: 0,
  /** Chatbot conversations. 90 days balances correlation with submissions against indefinite browsing history. */
  chatSessionDays: 90,
  /** Reader accounts, measured against `last_seen_at`. Same window as the audit trail. */
  readerAccountDays: 365,
  /**
   * Broadcast sessions, measured against `ended_at`. The same 90 days as chat
   * sessions, and for the same reason — this is a transcript of what the public
   * typed, and the live chat rows carry the same kind of data as a chat session.
   * Measured from the END, never the start: a broadcast that began 100 days ago
   * and finished this morning is a day old.
   */
  livestreamSessionDays: 90,
} as const

export const DATA_RETENTION_BOUNDS = {
  activityLogDays: { min: 30, max: 3650 },
  submissionDays: { min: 30, max: 3650 },
  chatSessionDays: { min: 30, max: 3650 },
  readerAccountDays: { min: 30, max: 3650 },
  livestreamSessionDays: { min: 30, max: 3650 },
} as const

/**
 * Parse a retention window. Unlike the analytics parser, `0` is meaningful
 * here — it disables the purge rather than being an out-of-range value — so
 * the bounds are only applied to non-zero settings.
 */
export function parseRetentionDays(
  name: string,
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be 0 (keep indefinitely) or a positive integer`)
  }
  if (parsed === 0) return 0
  if (parsed < min || parsed > max) {
    throw new Error(`${name} must be 0 or an integer between ${min} and ${max}`)
  }
  return parsed
}

export function resolveDataRetentionConfig(env: Record<string, unknown> = process.env) {
  return {
    activityLogDays: parseRetentionDays(
      'ACTIVITY_LOG_RETENTION_DAYS',
      env.ACTIVITY_LOG_RETENTION_DAYS,
      DATA_RETENTION_DEFAULTS.activityLogDays,
      DATA_RETENTION_BOUNDS.activityLogDays.min,
      DATA_RETENTION_BOUNDS.activityLogDays.max,
    ),
    submissionDays: parseRetentionDays(
      'SUBMISSION_RETENTION_DAYS',
      env.SUBMISSION_RETENTION_DAYS,
      DATA_RETENTION_DEFAULTS.submissionDays,
      DATA_RETENTION_BOUNDS.submissionDays.min,
      DATA_RETENTION_BOUNDS.submissionDays.max,
    ),
    chatSessionDays: parseRetentionDays(
      'CHAT_SESSION_RETENTION_DAYS',
      env.CHAT_SESSION_RETENTION_DAYS,
      DATA_RETENTION_DEFAULTS.chatSessionDays,
      DATA_RETENTION_BOUNDS.chatSessionDays.min,
      DATA_RETENTION_BOUNDS.chatSessionDays.max,
    ),
    readerAccountDays: parseRetentionDays(
      'READER_ACCOUNT_RETENTION_DAYS',
      env.READER_ACCOUNT_RETENTION_DAYS,
      DATA_RETENTION_DEFAULTS.readerAccountDays,
      DATA_RETENTION_BOUNDS.readerAccountDays.min,
      DATA_RETENTION_BOUNDS.readerAccountDays.max,
    ),
    livestreamSessionDays: parseRetentionDays(
      'LIVESTREAM_SESSION_RETENTION_DAYS',
      env.LIVESTREAM_SESSION_RETENTION_DAYS,
      DATA_RETENTION_DEFAULTS.livestreamSessionDays,
      DATA_RETENTION_BOUNDS.livestreamSessionDays.min,
      DATA_RETENTION_BOUNDS.livestreamSessionDays.max,
    ),
  }
}
