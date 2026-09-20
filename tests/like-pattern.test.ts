import { test } from 'node:test'
import assert from 'node:assert/strict'
import { escapeLikePattern, likeContains } from '../server/utils/like-pattern'

test('escapeLikePattern escapes the three SQL LIKE metacharacters', () => {
  // `%` and `_` are wildcards in LIKE; `\` is the default escape char.
  // Without escaping, a user-typed `_` matches any single character.
  assert.equal(escapeLikePattern('a_b%c\\d'), 'a\\_b\\%c\\\\d')
})

test('escapeLikePattern leaves ordinary text untouched', () => {
  assert.equal(escapeLikePattern('Tin nóng 2026'), 'Tin nóng 2026')
})

test('escapeLikePattern handles a pattern that is only metacharacters', () => {
  assert.equal(escapeLikePattern('%%__\\\\'), '\\%\\%\\_\\_\\\\\\\\')
})

test('likeContains wraps the escaped input in %...%', () => {
  // The wrapper must escape BEFORE adding the SQL wildcards, otherwise the
  // user’s own `%` would survive and match arbitrary text.
  assert.equal(likeContains('a%b'), '%a\\%b%')
})

test('likeContains produces a pattern whose inner wildcards are inert', () => {
  // Round-trip sanity: a search for a literal underscore must not become a
  // single-char-any wildcard in the emitted pattern.
  const p = likeContains('a_b')
  assert.ok(p.includes('\\_'), 'underscore must be backslash-escaped')
  assert.ok(!/[^\\]_/.test(p), 'no unescaped underscore should remain')
})
