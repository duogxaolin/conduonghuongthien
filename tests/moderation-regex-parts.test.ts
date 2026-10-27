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
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { ALL_SAMPLES, SAMPLE_CHARS } from '../server/services/moderation-regex-parser.ts'

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
