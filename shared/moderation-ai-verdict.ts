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
 *     MODEL wrote (and the model reads user content), so it is cleaned and cut here; `at` is when.
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
  /**
   * When the AI judged, as `Date#toISOString()` writes it (UTC, `…Z`). The page shows it (Vietnam
   * time) so an officer can tell a verdict from an EARLIER pass — the column is never cleared: an
   * officer showing the content, a later pass that says safe, a hide by the keyword fallback all
   * leave it (KNOWN W-1/W-2, docs/decisions/realm-safety.md). Absent on verdicts noted before the
   * field, and dropped on read when it is anything but such a string — the verdict still shows.
   */
  at?: string
}

/** Code points kept of the model's reason — one or two sentences; the prompt asks for one. */
export const QUEUE_AI_VERDICT_REASON_MAX_LENGTH = 300

/** Combining marks kept in a row on one letter: two is the most Vietnamese needs (NFD "ệ" = e + U+0323 + U+0302). */
export const QUEUE_AI_VERDICT_MAX_COMBINING_RUN = 2

const isKind = (value: unknown): value is QueueAiVerdictKind =>
  typeof value === 'string' && (QUEUE_AI_VERDICT_KINDS as readonly string[]).includes(value)
const isSeverity = (value: unknown): value is QueueAiVerdictSeverity =>
  typeof value === 'string' && (QUEUE_AI_VERDICT_SEVERITIES as readonly string[]).includes(value)
const isJudgedAt = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  // Round trip: V8 reads "2026-02-31T…" as 3 March — only a real instant written as toISOString writes it.
  && new Date(value).toISOString() === value

/**
 * Code points that show nothing (or a blank) and carry no meaning in a reason — removed before
 * anything else, so they cannot split a run of marks or of white space:
 *   - `Cf` format (bidi overrides/isolates that reorder the line on screen, zero-width space/joiner,
 *     BOM, tag characters, the interlinear annotation anchors U+FFF9–FFFB that hide what they
 *     annotate — most of `Cf` is also default-ignorable below, those are not), `Cs` lone
 *     surrogates, `Co` private use (every plane — a font may draw anything there, or nothing);
 *   - `Default_Ignorable_Code_Point`, which `Cf` misses: the Hangul fillers U+115F, U+1160,
 *     U+3164, U+FFA0 (letters by category, blank on screen), variation selectors U+FE00–FE0F and
 *     U+E0100–E01EF (marks — an emoji keeps its picture, it may lose its colour form),
 *     the combining grapheme joiner U+034F;
 *   - noncharacters (U+FDD0–FDEF, U+xxFFFE/xxFFFF) and U+2800 BRAILLE PATTERN BLANK (a symbol
 *     that draws as an empty cell — the usual "invisible letter" of chat apps).
 * Written as escapes only: this file carries none of them (Trojan Source).
 */
const INVISIBLE = /[\p{Cf}\p{Cs}\p{Co}\p{Default_Ignorable_Code_Point}\p{Noncharacter_Code_Point}\u{2800}]+/gu
/** A run of combining marks longer than `QUEUE_AI_VERDICT_MAX_COMBINING_RUN` ("Zalgo" text spilling over the lines around it) keeps its first ones. */
const MARK_PILE = new RegExp(`(\\p{M}{${QUEUE_AI_VERDICT_MAX_COMBINING_RUN}})\\p{M}+`, 'gu')
const MARK = /^\p{M}$/u

/**
 * The model's reason as an officer may read it: the invisible code points above removed, then
 * every run of combining marks cut to two, every run of control characters and white space one
 * space, cut by code point with "…" — never half an emoji, and never a letter without the marks
 * that make it (a cut inside NFD "ệ" drops the whole letter, not its circumflex). Vietnamese in NFC
 * or NFD comes out as it went in: nothing is normalised. Anything but a string — the model
 * returned a number, an object — is no reason: ''.
 */
export function cleanQueueAiVerdictReason(value: unknown): string {
  if (typeof value !== 'string') return ''
  const cleaned = value.replace(INVISIBLE, '').replace(MARK_PILE, '$1').replace(/[\p{Cc}\s]+/gu, ' ').trim()
  const points = Array.from(cleaned)
  if (points.length <= QUEUE_AI_VERDICT_REASON_MAX_LENGTH) return cleaned
  let keep = QUEUE_AI_VERDICT_REASON_MAX_LENGTH - 1
  // The first code point cut off is a mark: its letter straddles the cut — cut before that letter.
  while (keep > 0 && MARK.test(points[keep]!)) keep--
  return `${points.slice(0, keep).join('').trimEnd()}…`
}

/**
 * The verdict to store, from the parsed reply; `null` when the reply is not a violation/spam verdict.
 * `judgedAt` is when the check read the reply (a parameter so a test can fix it).
 */
export function queueAiVerdictFromReply(
  reply: { verdict: unknown, severity: unknown, reason: unknown },
  judgedAt: Date = new Date(),
): QueueAiVerdict | null {
  if (!isKind(reply.verdict)) return null
  return {
    verdict: reply.verdict,
    // The check counts an unknown risk level as `high` (a model steered off the list); so does this.
    severity: isSeverity(reply.severity) ? reply.severity : 'high',
    reason: cleanQueueAiVerdictReason(reply.reason),
    at: judgedAt.toISOString(),
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
  const { verdict, severity, reason, at } = value as Record<string, unknown>
  if (!isKind(verdict) || !isSeverity(severity)) return null
  return { verdict, severity, reason: cleanQueueAiVerdictReason(reason), ...(isJudgedAt(at) ? { at } : {}) }
}
