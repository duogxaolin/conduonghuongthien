/**
 * Internals of the `moderation-regex` family that the barrel does not export
 * (`server/services/moderation-regex-*.ts`). Tests may import a part directly: the
 * boundaries guard (`tests/service-split-boundaries.test.ts`, rule 6) scans production
 * code only, and the barrel's API is pinned there and in
 * `tests/moderation-regex-seams-behavior.test.ts`.
 *
 * `SAMPLE_CHARS` is the sample table Layer 1 uses to decide whether two character classes
 * share a character. It holds invisible characters (Unicode spaces, BOM, combining marks,
 * the Kelvin sign): dropping one, or swapping one for a look-alike (U+2007 FIGURE SPACE for
 * U+2008 PUNCTUATION SPACE), is invisible in review and in every behaviour test that does
 * not happen to use that very character. So the table is pinned here as code points, in
 * order (`literalOfEscape` returns the first sample an escape matches), written as ASCII hex
 * — never derived from the import, and never pasted as the invisible characters themselves.
 *
 * The three Layer-1 holes fixed in wave3 4.3b each had a root in a part, checked here against
 * the engine itself rather than against a list someone wrote:
 *   - `foldCase` (literal words compare as the `iu` flag folds): over every character whose
 *     `iu` class is not just itself, same fold ⇔ same class, class by class;
 *   - `isRegExpGroupName` (`(?<name>` follows JS identifier rules): agrees with
 *     `new RegExp('(?<name>)', 'u')` on every BMP code point, a stride of astral ones, and
 *     `\u` escapes;
 *   - `analysisNumbers` (no estimate is ever NaN — a NaN compares false against every limit).
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { analysisNumbers } from '../server/services/moderation-regex-analysis.ts'
import { MODERATION_REGEX_FLAGS } from '../server/services/moderation-regex-limits.ts'
import {
  ALL_SAMPLES,
  SAMPLE_CHARS,
  foldCase,
  isRegExpGroupName,
} from '../server/services/moderation-regex-parser.ts'

const run = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)

const EXPECTED_SAMPLE_CODE_POINTS: readonly number[] = [
  // Printable ASCII.
  ...run(0x20, 0x7e),
  // Common whitespace and control characters, in source order: \t \n \r \v \f NUL.
  0x09, 0x0a, 0x0d, 0x0b, 0x0c, 0x00,
  // Unicode spaces: NO-BREAK SPACE, OGHAM SPACE MARK, EN QUAD, FIGURE SPACE, HAIR SPACE,
  // LINE SEPARATOR, PARAGRAPH SEPARATOR, NARROW NO-BREAK SPACE, MEDIUM MATHEMATICAL SPACE,
  // IDEOGRAPHIC SPACE, ZERO WIDTH NO-BREAK SPACE (BOM).
  0x00a0, 0x1680, 0x2000, 0x2007, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
  // Latin-1 (¡ … ÿ).
  ...run(0xa1, 0xff),
  // Vietnamese letters, precomposed: each lowercase letter, then its uppercase — the ones
  // already in Latin-1 (à, á, â, è…) are not added twice.
  0x1ea3, 0x1ea2, 0x1ea1, 0x1ea0, 0x0103, 0x0102, 0x1eb1, 0x1eb0, 0x1eaf, 0x1eae, 0x1eb3, 0x1eb2,
  0x1eb5, 0x1eb4, 0x1eb7, 0x1eb6, 0x1ea7, 0x1ea6, 0x1ea5, 0x1ea4, 0x1ea9, 0x1ea8, 0x1eab, 0x1eaa,
  0x1ead, 0x1eac, 0x1ebb, 0x1eba, 0x1ebd, 0x1ebc, 0x1eb9, 0x1eb8, 0x1ec1, 0x1ec0, 0x1ebf, 0x1ebe,
  0x1ec3, 0x1ec2, 0x1ec5, 0x1ec4, 0x1ec7, 0x1ec6, 0x1ec9, 0x1ec8, 0x0129, 0x0128, 0x1ecb, 0x1eca,
  0x1ecf, 0x1ece, 0x1ecd, 0x1ecc, 0x1ed3, 0x1ed2, 0x1ed1, 0x1ed0, 0x1ed5, 0x1ed4, 0x1ed7, 0x1ed6,
  0x1ed9, 0x1ed8, 0x01a1, 0x01a0, 0x1edd, 0x1edc, 0x1edb, 0x1eda, 0x1edf, 0x1ede, 0x1ee1, 0x1ee0,
  0x1ee3, 0x1ee2, 0x1ee7, 0x1ee6, 0x0169, 0x0168, 0x1ee5, 0x1ee4, 0x01b0, 0x01af, 0x1eeb, 0x1eea,
  0x1ee9, 0x1ee8, 0x1eed, 0x1eec, 0x1eef, 0x1eee, 0x1ef1, 0x1ef0, 0x1ef3, 0x1ef2, 0x1ef7, 0x1ef6,
  0x1ef9, 0x1ef8, 0x1ef5, 0x1ef4, 0x0111, 0x0110,
  // Combining tone marks (decomposed Vietnamese): grave, acute, tilde, hook above, dot below.
  0x0300, 0x0301, 0x0303, 0x0309, 0x0323,
  // Representatives: ARABIC-INDIC DIGIT ZERO, a Han character, KELVIN SIGN, MINUS SIGN,
  // EN DASH, LEFT DOUBLE QUOTATION MARK (ß, also in the source list, is already in Latin-1),
  // and an astral emoji.
  0x0660, 0x4e2d, 0x212a, 0x2212, 0x2013, 0x201c, 0x1f600,
]

test('SAMPLE_CHARS: exactly these code points, in this order — one code point per sample, no look-alike swapped in', () => {
  assert.equal(EXPECTED_SAMPLE_CODE_POINTS.length, 321)
  assert.deepEqual(SAMPLE_CHARS.map(c => c.codePointAt(0)), EXPECTED_SAMPLE_CODE_POINTS)
  for (const c of SAMPLE_CHARS) assert.equal(String.fromCodePoint(c.codePointAt(0)!), c, 'one code point per sample')
  // The Kelvin sign and the figure space are the two a careless edit loses silently.
  assert.ok(SAMPLE_CHARS.includes('K') && SAMPLE_CHARS.includes(' ') && !SAMPLE_CHARS.includes(' '))
})

test('ALL_SAMPLES is the same characters as SAMPLE_CHARS, as a set', () => {
  assert.deepEqual([...ALL_SAMPLES], [...SAMPLE_CHARS])
})

// ── Gập chữ của cờ `iu` (regression moderation-regex-3) ─────────────────────

const cpEscape = (c: string) => `\\u{${c.codePointAt(0)!.toString(16)}}`

test('foldCase is exactly the case folding of the iu flag: same class ⇔ same fold, over every character whose class is not just itself', () => {
  // A non-trivial `iu` class always holds a character that changes when case-folded, so the
  // engine's own closure of \p{Changes_When_Casefolded} under `iu` is every character that
  // has a class; every other character only matches itself, and `foldCase` (which returns
  // only what the engine confirms) leaves it alone. Computed from the running engine, so it
  // holds on each Node's own Unicode version.
  const inSomeClass = new RegExp('^[\\p{Changes_When_Casefolded}]$', MODERATION_REGEX_FLAGS)
  const cased: string[] = []
  for (let cp = 0; cp <= 0x10ffff; cp += 1) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue
    const c = String.fromCodePoint(cp)
    if (inSomeClass.test(c)) cased.push(c)
  }
  assert.ok(cased.length > 2000, `${cased.length} characters with a class`)
  const byFold = new Map<string, Set<string>>()
  for (const c of cased) {
    const folded = foldCase(c)
    byFold.set(folded, (byFold.get(folded) ?? new Set()).add(c))
  }
  const mismatches: string[] = []
  for (const [folded, members] of byFold) {
    if (!members.has(folded) || foldCase(folded) !== folded)
      mismatches.push(`${cpEscape(folded)} is not a fixed member of its own class`)
    const engineClass = new RegExp(`^[${[...members].map(cpEscape).join('')}]$`, MODERATION_REGEX_FLAGS)
    for (const d of cased)
      if (engineClass.test(d) !== members.has(d))
        mismatches.push(`[${[...members].map(cpEscape).join('')}] and ${cpEscape(d)}: the engine says ${members.has(d) ? 'apart' : 'same class'}`)
  }
  assert.deepEqual(mismatches.slice(0, 20), [], `${mismatches.length} mismatches`)
})

test('foldCase: the folds toLowerCase misses, and the pairs iu keeps apart', () => {
  const same = (a: string, b: string) => assert.equal(foldCase(a), foldCase(b), `${cpEscape(a)} ≡ ${cpEscape(b)}`)
  const apart = (a: string, b: string) => assert.notEqual(foldCase(a), foldCase(b), `${cpEscape(a)} ≢ ${cpEscape(b)}`)
  same('s', 'ſ') // LATIN SMALL LETTER LONG S — toLowerCase keeps it
  same('S', 'ſ')
  same('k', 'K') // KELVIN SIGN
  same('σ', 'ς') // σ, final ς — toLowerCase keeps ς
  same('μ', 'µ') // μ, MICRO SIGN
  same('ß', 'ẞ') // ß, capital ẞ
  same('a', 'A')
  same('đ', 'Đ')
  same('ữ', 'Ữ')
  apart('i', 'ı') // dotless ı has no simple folding to i
  apart('i', 'İ') // İ folds to i only in full (two-character) folding
  apart('s', 'ß') // ß → ss is a full folding, not a simple one
  assert.equal(foldCase('\u{1F600}'), '\u{1F600}')
  assert.equal(foldCase('中'), '中')
})

// ── Tên nhóm (regression moderation-regex-1) ────────────────────────────────

/**
 * Does the engine take `name` as a group name? `(?<name>)` alone is ambiguous — `(?<!>)` and
 * `(?<=>)` are lookbehinds — so the probe also refers back to it (`\k<name>`, which in `u`
 * mode must name a group). A name holding `>` is never asked: the parser ends a name at the
 * first `>`, and `(?<a>>)` is a group `a` holding `>`.
 */
const engineAcceptsName = (name: string) => {
  try {
    new RegExp(`(?<${name}>)\\k<${name}>`, 'u')
    return true
  } catch {
    return false
  }
}

test('isRegExpGroupName agrees with the engine: every BMP code point first and later in a name, a stride of astral ones, and \\u escapes', () => {
  const disagreements: string[] = []
  const check = (name: string) => {
    if (name.includes('>')) assert.equal(isRegExpGroupName(name), false, JSON.stringify(name))
    else if (isRegExpGroupName(name) !== engineAcceptsName(name)) disagreements.push(JSON.stringify(name))
  }
  const astral: number[] = []
  for (let cp = 0x10000; cp <= 0x10ffff; cp += 61) astral.push(cp)
  for (const cp of [...run(0, 0xffff), ...astral, 0x1d49c, 0x20000, 0xe0100]) {
    const c = String.fromCharCode(...(cp <= 0xffff ? [cp] : [0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 0x3ff)]))
    check(c)
    check(`a${c}`)
  }
  for (let cp = 0; cp <= 0x10ffff; cp += cp < 0x3000 ? 7 : 997) {
    const hex = cp.toString(16)
    check(`\\u{${hex}}`)
    check(`a\\u{${hex}}`)
    if (cp <= 0xffff) check(`\\u${hex.padStart(4, '0')}`)
  }
  for (const name of [
    '\\uD835\\uDC9C', // two escapes forming one astral letter
    'a\\uD835\\uDC9C',
    '\\uD835', // a lead surrogate alone
    '\\uDC9C',
    '\\uD835\\u0041', // a lead, then not a trail
    '\\u{D835}\\u{DC9C}', // braced halves are two code points, never a pair
    '\\u{110000}',
    '\\u{0000000041}',
    '\\x41',
    '\\u004',
    '\\',
    'a\\',
    '',
    'a‌‍', // ZWNJ, ZWJ continue a name
    '‍a',
    '$',
    '_',
    'a$_1',
  ])
    check(name)
  assert.deepEqual(disagreements.slice(0, 20), [], `${disagreements.length} disagreements`)
})

// ── Không bao giờ NaN (regression moderation-regex-2) ───────────────────────

test('analysisNumbers: no width, choice count or sequence cost is ever NaN — for every shape, repeated 0, once, unbounded and a huge number of times', () => {
  const shapes = ['a', 'ab', '\\s', '[sſ]', '.', '\\s*', '\\s+', 'a?', '(?:a|)', '(?:a|ab)', '(?:a+)+', '^', '$', '\\b', '(?=a)', '(?:)', '(x)\\1', '(?<n>x)\\k<n>', '\\s{1,3}']
  const counts = ['{0}', '{0,0}', '{1}', '{0,1}', '*', '+', '{2,}', '{1,3}', '{999999999}', '{0,2147483647}']
  let checked = 0
  for (const shape of shapes)
    for (const count of counts)
      for (const pattern of [`(?:${shape})${count}`, `(?:${shape})${count}\\s*\\s*$`, `x(?:(?:${shape})${count})${count}y`, `\\s*(?:${shape})${count}\\s*`]) {
        try {
          new RegExp(pattern, MODERATION_REGEX_FLAGS)
        } catch {
          continue
        }
        checked += 1
        const numbers = analysisNumbers(pattern)
        assert.ok(numbers.length > 0 && numbers.every(n => !Number.isNaN(n)), `${pattern}: ${JSON.stringify(numbers)}`)
      }
  assert.ok(checked > 500, `${checked} patterns`)
})
