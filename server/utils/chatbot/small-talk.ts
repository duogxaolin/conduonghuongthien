/**
 * Pure, DB-backed everyday-conversation classifier.
 *
 * The approved business bank is deliberately outside this module and is always
 * queried first by chat-policy. This classifier receives already-loaded DB rows,
 * selects one deterministically, and returns that row's answer unchanged.
 */

export type SmallTalkIntent =
  | 'greeting'
  | 'thanks'
  | 'acknowledgement'
  | 'goodbye'
  | 'praise'
  | 'complaint'
  | 'identity'
  | 'capability'
  | 'navigation'
  | 'portal_facts'
  | 'support'

export type SmallTalkContext = {
  /** Server-derived from at most the immediately preceding user turn. */
  previousIntent?: SmallTalkIntent
}

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
export type SmallTalkClassification = SmallTalkMatch & { intent: SmallTalkIntent }

const MAX_CHARS = 120
const MAX_TOKENS = 20
const SHORT_WORD_MAX = 4

const BUSINESS_MARKERS = [
  'thu tuc', 'giay to', 'ho so', 'dieu kien', 'quy dinh', 'thoi han', 'bao lau',
  'vay von', 'dang ky', 'xoa an tich', 'cu tru', 'ho tro viec lam', 'hoc nghe',
  'quyen loi', 'can lam gi', 'lam the nao', 'nhu the nao',
]

/** Exact-only rules for terse turns whose legacy DB rows lack those aliases. */
const SHORT_INTENTS: Readonly<Record<string, SmallTalkIntent>> = Object.freeze({
  hi: 'greeting',
  hello: 'greeting',
  ok: 'acknowledgement',
  u: 'acknowledgement',
  da: 'acknowledgement',
  'duoc roi': 'acknowledgement',
  'cam on': 'thanks',
  bye: 'goodbye',
  goodbye: 'goodbye',
  hay: 'praise',
  'hay qua': 'praise',
  tuyet: 'praise',
})

/** NFKC, Vietnamese case-folding, accent folding and punctuation removal. */
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

/** Human-readable normalization for the indexed DB key. */
export function normalizeQuestion(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('vi-VN').replace(/\s+/gu, ' ').slice(0, 191)
}

function tokensOf(value: string): string[] {
  return value.split(' ').filter(Boolean)
}

function containsPhrase(tokens: string[], phrase: string[]): boolean {
  if (!phrase.length || phrase.length > tokens.length) return false
  for (let start = 0; start <= tokens.length - phrase.length; start++) {
    if (phrase.every((word, offset) => tokens[start + offset] === word)) return true
  }
  return false
}

function isShortWord(patternTokens: string[]): boolean {
  return patternTokens.length === 1 && patternTokens[0]!.length <= SHORT_WORD_MAX
}

function looksLikeBusinessQuery(normalized: string): boolean {
  return BUSINESS_MARKERS.some(marker => normalized.includes(marker))
}

/**
 * Intent is inferred from the visitor's wording plus the row's coarse category.
 * Context is deliberately impact-limited: it can only disambiguate an otherwise
 * matched acknowledgement; it can never make an unmatched turn match.
 */
function inferIntent(category: string, normalized: string, context: SmallTalkContext): SmallTalkIntent {
  if (category === 'navigation') return 'navigation'
  if (category === 'portal_facts') return 'portal_facts'
  if (category === 'support') return 'support'
  if (category === 'identity') {
    return /\b(?:lam duoc gi|co the lam gi|ho tro|biet gi|hoi.*duoc gi|noi chuyen|tra loi)\b/u.test(normalized)
      ? 'capability'
      : 'identity'
  }

  if (/^(?:xin chao|chao|hi|hello|alo|good morning|good afternoon|good evening)(?:$|\s)/u.test(normalized)) return 'greeting'
  if (/(?:^|\s)(?:cam on|biet on)(?:$|\s)/u.test(normalized)) return 'thanks'
  if (/^(?:bye|goodbye|tam biet|hen gap lai|toi di day|minh di nhe)(?:$|\s)/u.test(normalized)) return 'goodbye'
  if (/^(?:hay|hay qua|tuyet|tuyet voi|gioi qua|tot|tot qua|qua tuyet|de thuong qua|lam tot lam)(?:$|\s)/u.test(normalized)) return 'praise'
  if (/(?:xin loi|cham qua|phan hoi cham|lam phien|phien qua|buc|kho chiu|khong hai long)/u.test(normalized)) return 'complaint'
  if (/^(?:ok|okay|oke|okey|uh|uhm|um|u|da|duoc|duoc roi|roi|vang|hieu roi|biet roi|ro roi|nam duoc roi)(?:$|\s)/u.test(normalized)) return 'acknowledgement'

  return context.previousIntent === 'goodbye' ? 'acknowledgement' : 'greeting'
}

function order(a: SmallTalkEntry, b: SmallTalkEntry): number {
  return (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || a.id - b.id
}

function toMatch(entry: SmallTalkEntry): SmallTalkMatch {
  return { id: entry.id, category: entry.category, answer: entry.answer }
}

/**
 * Existing compatibility API: select a DB row but do not expose intent.
 *
 * Tiers: exact canonical question, exact pattern, then contiguous multi-token
 * pattern. Longest phrase wins; displayOrder/id break ties. A one-token pattern
 * of four characters or fewer only matches the entire message. In addition,
 * acknowledgement/thanks rows cannot capture a longer business-looking query.
 */
export function matchSmallTalk(entries: readonly SmallTalkEntry[], query: unknown): SmallTalkMatch | null {
  if (!Array.isArray(entries) || entries.length === 0 || typeof query !== 'string') return null
  const normalized = plain(query)
  if (!normalized || normalized.length > MAX_CHARS) return null
  const tokens = tokensOf(normalized)
  if (!tokens.length || tokens.length > MAX_TOKENS) return null

  const prepared = [...entries]
    .filter(entry => entry.isEnabled)
    .map(entry => ({
      entry,
      patterns: (entry.patterns ?? [])
        .map((pattern: string) => plain(String(pattern)))
        .filter(Boolean)
        .map((text: string) => ({ text, tokens: tokensOf(text) })),
      normalizedQuestionPlain: plain(entry.normalizedQuestion),
    }))
  if (!prepared.length) return null

  let selected = prepared
    .filter(item => item.normalizedQuestionPlain === normalized)
    .map(item => item.entry)
    .sort(order)[0]

  if (!selected) {
    selected = prepared
      .filter(item => item.patterns.some((pattern: { text: string }) => pattern.text === normalized))
      .map(item => item.entry)
      .sort(order)[0]
  }

  if (!selected && SHORT_INTENTS[normalized]) {
    const requestedIntent = SHORT_INTENTS[normalized]
    selected = prepared
      .filter(item => inferIntent(item.entry.category, item.normalizedQuestionPlain, {}) === requestedIntent)
      .map(item => item.entry)
      .sort(order)[0]
  }

  if (!selected) {
    let best: { entry: SmallTalkEntry; length: number } | null = null
    for (const item of prepared) {
      for (const pattern of item.patterns) {
        if (isShortWord(pattern.tokens) || !containsPhrase(tokens, pattern.tokens)) continue
        if (!best || pattern.tokens.length > best.length || (pattern.tokens.length === best.length && order(item.entry, best.entry) < 0)) {
          best = { entry: item.entry, length: pattern.tokens.length }
        }
      }
    }
    selected = best?.entry
  }

  if (!selected) return null
  const intent = inferIntent(selected.category, normalized, {})
  if ((intent === 'acknowledgement' || intent === 'thanks') && tokens.length > 2 && looksLikeBusinessQuery(normalized)) return null
  return toMatch(selected)
}

/** Classify a turn and return the answer selected from the matched DB row. */
export function classifySmallTalk(entries: readonly SmallTalkEntry[], query: unknown, context: SmallTalkContext = {}): SmallTalkClassification | null {
  const match = matchSmallTalk(entries, query)
  if (!match || typeof query !== 'string') return null
  return { ...match, intent: inferIntent(match.category, plain(query), context) }
}
