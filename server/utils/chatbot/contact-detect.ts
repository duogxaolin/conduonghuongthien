/**
 * Detects contact details a visitor typed into the chat.
 *
 * Why this exists: a visitor often gives a phone number mid-conversation
 * ("gọi em số 0903480985 nhé") instead of using the lead-capture form, and that
 * turn is the only record of it. Surfacing it on the admin session list is the
 * difference between a follow-up and a lost one.
 *
 * Pure functions — no database, no request context — so they are testable
 * directly and cannot be the reason a chat reply fails.
 */

/**
 * Vietnamese mobile prefixes after normalising to the local `0…` form.
 * Landlines are deliberately excluded: their prefixes overlap heavily with
 * ordinary numbers a visitor might type (dates, article ids, money amounts),
 * and a wrong phone number on an admin screen is worse than a missing one.
 */
const MOBILE_PREFIXES = ['03', '05', '07', '08', '09']

/**
 * Normalises a candidate to `0XXXXXXXXX` (10 digits) or returns null.
 * Accepts `+84…`, `84…`, and `0…` with spaces, dots or dashes as separators.
 */
export function normalizeVietnamesePhone(raw: string): string | null {
  if (typeof raw !== 'string') return null

  let digits = raw.replace(/[\s.\-()]/g, '')
  if (digits.startsWith('+84')) digits = `0${digits.slice(3)}`
  else if (digits.startsWith('0084')) digits = `0${digits.slice(4)}`
  else if (digits.startsWith('84') && digits.length === 11) digits = `0${digits.slice(2)}`

  if (!/^\d{10}$/.test(digits)) return null
  if (!MOBILE_PREFIXES.includes(digits.slice(0, 2))) return null
  return digits
}

/**
 * Finds the first Vietnamese mobile number in free text, or null.
 *
 * The scan is anchored on non-digit boundaries so a 10-digit run inside a longer
 * number (an account id, a case number) is not mistaken for a phone.
 */
export function detectPhone(text: string): string | null {
  if (typeof text !== 'string' || !text) return null

  // Candidate runs: optional +84/84 prefix, then digits with optional separators.
  const candidates = text.match(/(?:\+?84|0)[\d\s.\-]{8,15}\d/g)
  if (!candidates) return null

  for (const candidate of candidates) {
    const normalized = normalizeVietnamesePhone(candidate)
    if (normalized) return normalized
  }
  return null
}

/**
 * Extracts a self-introduced name from phrasings staff actually see
 * ("tôi tên Nguyễn Văn A", "em là Trần Thị B", "mình tên là ...").
 *
 * Deliberately conservative: only fires on an explicit introduction verb. Any
 * attempt to guess a name from capitalisation alone misfires constantly in
 * Vietnamese, where sentence-initial words and proper nouns look alike, and a
 * wrong name attached to a session is actively misleading.
 */
const NAME_PATTERN = /(?:tôi|toi|em|mình|minh|anh|chị|chi|cháu|chau|con)\s+(?:tên|ten)\s*(?:là|la)?\s*[:\-]?\s*([\p{L}][\p{L}\s]{1,60})/iu

const NAME_ALT_PATTERN = /(?:tôi|toi|em|mình|minh|cháu|chau)\s+(?:là|la)\s+([\p{L}][\p{L}\s]{1,60})/iu

export function detectName(text: string): string | null {
  if (typeof text !== 'string' || !text) return null

  const match = NAME_PATTERN.exec(text) || NAME_ALT_PATTERN.exec(text)
  if (!match?.[1]) return null

  // Stop at the first punctuation-free clause boundary and cap length; a name
  // that swallowed the rest of the sentence is not a name.
  let cleaned = match[1]
    .split(/[,.;!?\n]/)[0]!
    .trim()
    .replace(/\s{2,}/g, ' ')

  // Vietnamese sentence-final particles are extremely common in polite speech
  // ("em là Trần Thị B ạ") and are not part of the name. Stripped iteratively
  // because they stack: "... nhé ạ".
  //
  // Accented forms only, and only words that cannot be a name component. The
  // un-accented "a" is deliberately absent: "Nguyễn Văn A" is the single most
  // common way a Vietnamese name is written down, and stripping that "A" would
  // corrupt more names than it cleans. Likewise "nha"/"Nhã" is a real given
  // name. Losing a trailing particle is cosmetic; losing a name syllable is not.
  const TRAILING_PARTICLES = new Set(['ạ', 'nhé', 'nhe', 'ơi', 'đó', 'đấy', 'thôi', 'với'])
  let words = cleaned.split(' ')
  while (words.length > 1 && TRAILING_PARTICLES.has(words[words.length - 1]!.toLowerCase())) {
    words.pop()
  }
  cleaned = words.join(' ')

  if (cleaned.length < 2 || cleaned.length > 64) return null

  // A "name" of five or more words is a sentence that happened to match.
  if (words.length > 5) return null

  return cleaned
}
