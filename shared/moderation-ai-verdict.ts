/**
 * What the AI moderator judged, kept on the PENDING queue row its automatic hide reused
 * (`ai_moderation_queue.ai_verdict`, nullable JSON) — shown to officers next to that row's own
 * reason on the queue tab and next to the hidden comment on `/admin/comments`.
 *
 * Why the column exists: `insertQueueRowOnce` files one pending row per target. When a row about the
 * content is already pending (a `flag_only` row filed while the AI was not configured, say) and the
 * AI later hides it (a rescan, the live pass of a livestream message), no row is filed for the AI's
 * verdict, and the hide writes the PENDING row's reason as its mark (`pendingQueueRow`, B01) so that
 * approving that row shows the content again. The verdict itself used to live only in the log: the
 * officer saw content hidden "because the AI is not configured". `flagged_reason` stays the mark —
 * it is never rewritten; the verdict goes in its own column.
 *
 * Both directions go through here, so the stored shape and what the pages receive cannot drift:
 *   - `queueAiVerdictFromReply` — the worker, from the model's parsed reply. Only `violation` /
 *     `spam` are verdicts; severity is the one the check already validated; the reason is text the
 *     MODEL wrote (and the model reads user content), so it is cleaned and cut here.
 *   - `readQueueAiVerdict` — the two admin endpoints, from whatever the column holds: NULL (every row
 *     written before the column, every row the AI filed itself), a JSON string (MariaDB returns its
 *     JSON alias, LONGTEXT, as text), or anything malformed → `null`, nothing shown.
 * The pages render it with text interpolation only (never `v-html`).
 */

export const QUEUE_AI_VERDICT_KINDS = ['violation', 'spam'] as const
export const QUEUE_AI_VERDICT_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const

export type QueueAiVerdictKind = typeof QUEUE_AI_VERDICT_KINDS[number]
export type QueueAiVerdictSeverity = typeof QUEUE_AI_VERDICT_SEVERITIES[number]

export interface QueueAiVerdict {
  verdict: QueueAiVerdictKind
  severity: QueueAiVerdictSeverity
  /** Cleaned, at most `QUEUE_AI_VERDICT_REASON_MAX_LENGTH` code points; may be empty. */
  reason: string
}

/** Code points kept of the model's reason — one or two sentences; the prompt asks for one. */
export const QUEUE_AI_VERDICT_REASON_MAX_LENGTH = 300

const isKind = (value: unknown): value is QueueAiVerdictKind =>
  typeof value === 'string' && (QUEUE_AI_VERDICT_KINDS as readonly string[]).includes(value)
const isSeverity = (value: unknown): value is QueueAiVerdictSeverity =>
  typeof value === 'string' && (QUEUE_AI_VERDICT_SEVERITIES as readonly string[]).includes(value)

/**
 * The model's reason as an officer may read it: control characters, format characters (bidi
 * overrides that would reorder the line on screen, zero-width characters) and lone surrogates
 * removed, every run of white space one space, cut by code point (never half an emoji) with "…".
 * Anything but a string — the model returned a number, an object — is no reason: ''.
 */
export function cleanQueueAiVerdictReason(value: unknown): string {
  if (typeof value !== 'string') return ''
  const cleaned = value.replace(/[\p{Cf}\p{Cs}]+/gu, '').replace(/[\p{Cc}\s]+/gu, ' ').trim()
  const points = Array.from(cleaned)
  if (points.length <= QUEUE_AI_VERDICT_REASON_MAX_LENGTH) return cleaned
  return `${points.slice(0, QUEUE_AI_VERDICT_REASON_MAX_LENGTH - 1).join('').trimEnd()}…`
}

/** The verdict to store, from the parsed reply; `null` when the reply is not a violation/spam verdict. */
export function queueAiVerdictFromReply(reply: { verdict: unknown, severity: unknown, reason: unknown }): QueueAiVerdict | null {
  if (!isKind(reply.verdict)) return null
  return {
    verdict: reply.verdict,
    // The check counts an unknown risk level as `high` (a model steered off the list); so does this.
    severity: isSeverity(reply.severity) ? reply.severity : 'high',
    reason: cleanQueueAiVerdictReason(reply.reason),
  }
}

/** What an admin endpoint returns for the stored column: the validated verdict, or `null`. */
export function readQueueAiVerdict(stored: unknown): QueueAiVerdict | null {
  let value = stored
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown
    } catch {
      return null
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const { verdict, severity, reason } = value as Record<string, unknown>
  if (!isKind(verdict) || !isSeverity(severity)) return null
  return { verdict, severity, reason: cleanQueueAiVerdictReason(reason) }
}
