/**
 * Everyday-reply matcher ("small talk") for the chatbot.
 *
 * WHY THIS EXISTS: retrieval (utils/chatbot/retrieval.ts) only accepts an entry
 * on an exact question, an exact alias, one keyword hit, or two overlapping
 * words of the canonical question. A greeting like "hi" or "chào bạn" satisfies
 * none of those, so `references` came back empty and every mode fell through to
 * the out-of-scope handler — the visitor said hello and was immediately asked
 * for their phone number. This module answers that narrow class of turns.
 *
 * WHAT CHANGED: the everyday-reply store now lives in the database table
 * `chatbot_small_talk` (see schema.ts), so officers edit the wording without a
 * deploy. This module is a PURE matcher: it takes the already-loaded, enabled
 * entries and a query, and returns the best match or null. It never touches the
 * database — the caller loads rows (see utils/chatbot/chat.ts) and passes them
 * in, which also lets tests drive it without a database.
 *
 * The business bank always wins: the caller only reaches this matcher when the
 * approved knowledge bank matched nothing.
 *
 * Matching is diacritic-insensitive and case-insensitive, so "chào", "chao",
 * and "CHÀO BẠN" all land.
 */

/** A small-talk row as far as the matcher cares. */
export type SmallTalkEntry = {
  id: number
  category: string
  answer: string
  patterns: string[] | null
  normalizedQuestion: string
  isEnabled: boolean
  displayOrder?: number
}

export type SmallTalkMatch = { id: number; category: string; answer: string }

/**
 * Extended length ceiling — a final safety net, not the primary matcher. A
 * 300-character message is almost certainly a real question, not a greeting.
 * The old hard gate (MAX_CHARS = 60 / MAX_TOKENS = 8) is gone: it rejected
 * exactly the kind of turn the store now needs to cover ("cho tôi hỏi dùng
 * dịch vụ này có mất phí không" is only 44 chars but 11 words). Full-phrase
 * matching gives us the specificity the old gate was compensating for.
 */
const MAX_CHARS = 120
const MAX_TOKENS = 20

/**
 * A short single-word pattern (≤ 4 chars in diacritic-stripped form, e.g.
 * "duoc", "oi", "ok", "da") is ubiquitous inside ordinary sentences, so it only
 * matches when it IS the whole message. This is why "tôi có được vay vốn không"
 * does not get hijacked by the "được" acknowledgement entry.
 */
const SHORT_WORD_MAX = 4

/**
 * NFKC + Vietnamese lowercase + diacritics stripped + đ→d + punctuation to
 * spaces. Exported so the seed and the matcher share ONE definition of
 * normalization — two copies would drift.
 */
export function plain(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('vi-VN')
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .replace(/[đĐ]/gu, 'd')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/**
 * Canonical, storage-facing normalization for the unique key. Same rules as the
 * knowledge bank's normalizedQuestion (NFKC + vi-VN lowercase + collapsed
 * whitespace) but capped at 191 chars to fit the indexed column. Diacritics are
 * KEPT here (the column stores a human-readable canonical question); the
 * matcher's `plain()` is what strips them for comparison.
 */
export function normalizeQuestion(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('vi-VN').replace(/\s+/gu, ' ').slice(0, 191)
}

/** True when `phrase`'s tokens appear as a contiguous run inside `tokens`. */
function containsPhrase(tokens: string[], phrase: string[]): boolean {
  if (!phrase.length || phrase.length > tokens.length) return false
  for (let start = 0; start <= tokens.length - phrase.length; start++) {
    if (phrase.every((word, offset) => tokens[start + offset] === word)) return true
  }
  return false
}

/** A pattern is a "short word" (whole-message-only) when it is a single token ≤ SHORT_WORD_MAX chars. */
function isShortWord(patternTokens: string[]): boolean {
  return patternTokens.length === 1 && patternTokens[0]!.length <= SHORT_WORD_MAX
}

/**
 * Classify a visitor turn as small talk, or return null to let the normal
 * knowledge / lead-capture path handle it.
 *
 * Three tiers, most specific first:
 *   1. exact match of the normalized question (diacritic-stripped)
 *   2. exact match of a whole pattern
 *   3. a pattern appearing as a contiguous run of tokens inside the message
 *
 * At tier 3 the LONGER pattern wins (more specific); ties break on the lower
 * displayOrder, then the lower id — fully deterministic. Short single-word
 * patterns are excluded from tier 3 (see SHORT_WORD_MAX): they only match as a
 * whole message, at tiers 1/2.
 *
 * Returning null is the safe default: an unmatched turn keeps exactly the
 * behaviour it had before this module existed.
 */
export function matchSmallTalk(entries: SmallTalkEntry[], query: unknown): SmallTalkMatch | null {
  if (!Array.isArray(entries) || entries.length === 0) return null
  if (typeof query !== 'string') return null
  const normalized = plain(query)
  if (!normalized) return null
  if (normalized.length > MAX_CHARS) return null
  const tokens = normalized.split(' ').filter(Boolean)
  if (!tokens.length || tokens.length > MAX_TOKENS) return null

  const enabled = entries.filter(entry => entry.isEnabled)
  if (!enabled.length) return null

  // Precompute plain-form patterns per entry once.
  const prepared = enabled.map(entry => ({
    entry,
    patterns: (entry.patterns ?? [])
      .map(pattern => plain(String(pattern)))
      .filter(Boolean)
      .map(pattern => ({ text: pattern, tokens: pattern.split(' ').filter(Boolean) }))
      .filter(pattern => pattern.tokens.length > 0),
    normalizedQuestionPlain: plain(entry.normalizedQuestion),
  }))

  // Deterministic ordering for tie-breaks: displayOrder, then id.
  const order = (a: SmallTalkEntry, b: SmallTalkEntry) =>
    (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || a.id - b.id

  // ── Tier 1: exact normalized-question match ──
  const tier1 = prepared
    .filter(item => item.normalizedQuestionPlain && item.normalizedQuestionPlain === normalized)
    .map(item => item.entry)
    .sort(order)
  if (tier1[0]) return toMatch(tier1[0])

  // ── Tier 2: exact whole-pattern match ──
  const tier2 = prepared
    .filter(item => item.patterns.some(pattern => pattern.text === normalized))
    .map(item => item.entry)
    .sort(order)
  if (tier2[0]) return toMatch(tier2[0])

  // ── Tier 3: pattern as a contiguous token run; longer pattern wins ──
  let best: { entry: SmallTalkEntry; length: number } | null = null
  for (const item of prepared) {
    for (const pattern of item.patterns) {
      if (isShortWord(pattern.tokens)) continue // short words match whole-message only
      if (!containsPhrase(tokens, pattern.tokens)) continue
      const length = pattern.tokens.length
      if (
        !best ||
        length > best.length ||
        (length === best.length && order(item.entry, best.entry) < 0)
      ) {
        best = { entry: item.entry, length }
      }
    }
  }
  return best ? toMatch(best.entry) : null
}

function toMatch(entry: SmallTalkEntry): SmallTalkMatch {
  return { id: entry.id, category: entry.category, answer: entry.answer }
}
