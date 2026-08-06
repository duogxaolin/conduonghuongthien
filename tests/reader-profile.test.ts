/**
 * The two pure functions behind the reader profile page.
 *
 * `effectiveDisplayName` exists because a reader's chosen name and the name
 * Google reports live in two different columns, and the OAuth callback keeps
 * overwriting the second one on every sign-in. If the precedence between them
 * were resolved at each call site instead, the header, the comment thread and the
 * moderation list would eventually disagree about what someone is called — and
 * the disagreement would only show up on a page where two of them appear at once.
 *
 * `validateDisplayName` is the one that decides what a citizen is allowed to be
 * called on a government portal. It is stricter than the comment-body validator
 * in one specific way, and the difference is the point: a comment is a paragraph
 * whose line breaks belong to its author, while a name is one line. A newline in
 * a name is not content — it is a name that has broken the layout of every list
 * it appears in.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DISPLAY_NAME_FALLBACK,
  DISPLAY_NAME_MAX_LENGTH,
  DISPLAY_NAME_MIN_LENGTH,
  effectiveDisplayName,
  validateDisplayName,
} from '../server/services/readers'

test('effectiveDisplayName prefers the name the reader chose', () => {
  assert.equal(
    effectiveDisplayName({ customDisplayName: 'Bác Ba', displayName: 'Nguyen Van A' }),
    'Bác Ba',
  )
})

test('effectiveDisplayName falls back to the Google name when no custom one is set', () => {
  assert.equal(effectiveDisplayName({ customDisplayName: null, displayName: 'Nguyễn Văn A' }), 'Nguyễn Văn A')
  assert.equal(effectiveDisplayName({ displayName: 'Nguyễn Văn A' }), 'Nguyễn Văn A')
})

test('effectiveDisplayName treats a whitespace-only custom name as absent', () => {
  // Not reachable through validateDisplayName, but reachable through a row
  // written before this column existed or by a future admin tool. Reading it as
  // a name would render a blank author on a public comment.
  assert.equal(effectiveDisplayName({ customDisplayName: '   ', displayName: 'Nguyễn Văn A' }), 'Nguyễn Văn A')
})

test('effectiveDisplayName never returns an empty string', () => {
  assert.equal(effectiveDisplayName({ customDisplayName: null, displayName: null }), DISPLAY_NAME_FALLBACK)
  assert.equal(effectiveDisplayName({}), DISPLAY_NAME_FALLBACK)
})

test('validateDisplayName accepts an ordinary Vietnamese name', () => {
  const result = validateDisplayName('Nguyễn Văn A')
  assert.equal(result.ok, true)
  assert.equal(result.ok && result.name, 'Nguyễn Văn A')
})

test('validateDisplayName trims and collapses runs of spaces', () => {
  // Without collapsing, "Nguyễn  Văn A" and "Nguyễn Văn A" are two rows that
  // render identically — one reader able to appear as two in the same thread.
  const result = validateDisplayName('  Nguyễn   Văn    A  ')
  assert.equal(result.ok && result.name, 'Nguyễn Văn A')
})

test('validateDisplayName refuses a non-string', () => {
  for (const input of [null, undefined, 42, {}, ['a']]) {
    assert.equal(validateDisplayName(input).ok, false, `${JSON.stringify(input)} was accepted`)
  }
})

test('validateDisplayName refuses an empty or whitespace-only name', () => {
  for (const input of ['', '   ', '\t\t']) {
    assert.equal(validateDisplayName(input).ok, false, `${JSON.stringify(input)} was accepted`)
  }
})

test('validateDisplayName refuses control characters, INCLUDING newline', () => {
  // The deliberate difference from validateBody in services/comments.ts, which
  // normalises CRLF to LF and keeps it. Folding a newline to a space here would
  // store something other than what was typed; keeping it would put a line break
  // in a name.
  for (const input of ['Nguyễn\nVăn A', 'Nguyễn\r\nVăn A', 'Nguyễn\tVăn A', 'A\u0000B', 'A\u007FB']) {
    assert.equal(validateDisplayName(input).ok, false, `${JSON.stringify(input)} was accepted`)
  }
})

test('validateDisplayName refuses a name shorter than the minimum', () => {
  const result = validateDisplayName('A')
  assert.equal(result.ok, false)
  assert.match(
    result.ok ? '' : result.message,
    new RegExp(String(DISPLAY_NAME_MIN_LENGTH)),
    'the message must state the limit — a reader who cannot see the rule cannot satisfy it',
  )
})

test('validateDisplayName REFUSES an over-long name rather than truncating it', () => {
  // Silent truncation is the failure mode this asserts against: a reader whose
  // name was cut has no way to find out that it was.
  const tooLong = 'A'.repeat(DISPLAY_NAME_MAX_LENGTH + 1)
  const result = validateDisplayName(tooLong)
  assert.equal(result.ok, false)
  assert.match(result.ok ? '' : result.message, new RegExp(String(DISPLAY_NAME_MAX_LENGTH)))
})

test('validateDisplayName accepts exactly the boundary lengths', () => {
  assert.equal(validateDisplayName('A'.repeat(DISPLAY_NAME_MIN_LENGTH)).ok, true)
  assert.equal(validateDisplayName('A'.repeat(DISPLAY_NAME_MAX_LENGTH)).ok, true)
})
