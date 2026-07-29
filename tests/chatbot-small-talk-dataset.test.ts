import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CHATBOT_SMALL_TALK_SEED, SMALL_TALK_CATEGORIES } from '../server/data/chatbot-small-talk-seed'
import { CHATBOT_HOTLINE } from '../server/utils/chatbot/prompt-defaults'
import { plain, normalizeQuestion } from '../server/utils/chatbot/small-talk'

/**
 * The default everyday-reply dataset is the public voice of a Ministry of Public
 * Security portal, so these tests are the guardrail that keeps it inside the
 * agreed content boundaries (design.md, decision 8).
 */

// ── shape & size ────────────────────────────────────────────────────────────────

test('every entry has the five categories only and a total within 120-160', () => {
  assert.ok(CHATBOT_SMALL_TALK_SEED.length >= 120 && CHATBOT_SMALL_TALK_SEED.length <= 160,
    `total is ${CHATBOT_SMALL_TALK_SEED.length}, expected 120-160`)
  for (const entry of CHATBOT_SMALL_TALK_SEED) {
    assert.ok((SMALL_TALK_CATEGORIES as readonly string[]).includes(entry.category), `bad category: ${entry.category}`)
  }
})

test('each of the five groups has at least 10 entries', () => {
  for (const category of SMALL_TALK_CATEGORIES) {
    const count = CHATBOT_SMALL_TALK_SEED.filter(entry => entry.category === category).length
    assert.ok(count >= 10, `group ${category} has only ${count} entries`)
  }
})

// ── patterns ──────────────────────────────────────────────────────────────────

test('every entry ships 3-7 patterns, all diacritic-free lowercase', () => {
  for (const entry of CHATBOT_SMALL_TALK_SEED) {
    assert.ok(entry.patterns.length >= 3 && entry.patterns.length <= 7,
      `"${entry.question}" has ${entry.patterns.length} patterns`)
    for (const pattern of entry.patterns) {
      assert.equal(typeof pattern, 'string')
      assert.ok(pattern.trim().length > 0, `empty pattern in "${entry.question}"`)
      // A pattern must already be in the matcher's plain() form: matching it
      // through plain() must be a no-op, otherwise it can never match at tier 2.
      assert.equal(plain(pattern), pattern, `pattern not in plain form: ${JSON.stringify(pattern)}`)
    }
  }
})

test('no pattern is shared between two different entries', () => {
  const seen = new Map<string, string>()
  for (const entry of CHATBOT_SMALL_TALK_SEED) {
    for (const pattern of entry.patterns) {
      const prior = seen.get(pattern)
      assert.equal(prior, undefined, `pattern ${JSON.stringify(pattern)} appears in "${prior}" and "${entry.question}"`)
      seen.set(pattern, entry.question)
    }
  }
})

test('no two entries collapse to the same normalized question', () => {
  const seen = new Map<string, string>()
  for (const entry of CHATBOT_SMALL_TALK_SEED) {
    const key = normalizeQuestion(entry.question)
    const prior = seen.get(key)
    assert.equal(prior, undefined, `normalized question ${JSON.stringify(key)} shared by "${prior}" and "${entry.question}"`)
    seen.set(key, entry.question)
  }
})

// ── content boundaries ──────────────────────────────────────────────────────────

test('the hotline is never written literally in source — always interpolated from CHATBOT_HOTLINE', () => {
  // Prove the constant really is the number we forbid as a literal, so the test
  // cannot be defeated by the constant drifting.
  assert.match(CHATBOT_HOTLINE, /\d/u)
  // Runtime answers legitimately CONTAIN the number (the template interpolates
  // it), so the guard has to inspect the SOURCE: the literal digits must never be
  // typed in the file — only `${CHATBOT_HOTLINE}` may appear.
  const source = readFileSync(new URL('../server/data/chatbot-small-talk-seed.ts', import.meta.url), 'utf8')
  assert.ok(!source.includes(CHATBOT_HOTLINE), 'a literal hotline string was typed into the seed source; use ${CHATBOT_HOTLINE}')
})

test('every support reply directs to Công an xã/phường or the hotline', () => {
  const support = CHATBOT_SMALL_TALK_SEED.filter(entry => entry.category === 'support')
  assert.ok(support.length >= 10)
  for (const entry of support) {
    const directsToContact = /Công an xã\/phường/u.test(entry.answer)
      || entry.answer.includes(CHATBOT_HOTLINE)
      || /đường dây nóng/u.test(entry.answer)
    assert.ok(directsToContact, `support reply does not steer to contact: "${entry.question}"`)
  }
})

test('no support reply promises an outcome or offers psychological counselling', () => {
  const banned = [/chắc chắn sẽ được/iu, /sẽ giải quyết xong/iu, /cam kết.*(được|thành công)/iu]
  for (const entry of CHATBOT_SMALL_TALK_SEED.filter(e => e.category === 'support')) {
    for (const rx of banned) assert.ok(!rx.test(entry.answer), `support reply makes a forbidden promise: "${entry.question}"`)
  }
})

test('no entry carries out-of-scope content (statutes, deadlines, medical/financial/political/news/weather/sport)', () => {
  // Diacritic-stripped so a term is caught regardless of accents.
  // Multi-word phrases only: single diacritic-stripped syllables ("khoan" ⊂
  // "tài khoản"/"băn khoăn") collide with ordinary vocabulary, so each term is a
  // phrase specific enough to be unambiguous out-of-scope content.
  const forbidden = [
    'nghi dinh so', 'thong tu so', 'dieu luat', 'bo luat hinh su', 'luat hinh su',
    'dieu khoan luat', 'thoi han xu ly', 'ngay lam viec ke tu',
    'bac si', 'chan doan benh', 'don thuoc', 'lieu thuoc',
    'lai suat ngan hang', 'chung khoan', 'co phieu', 'ty gia',
    'chinh tri', 'bau cu', 'thoi tiet', 'nhiet do hom nay', 'bong da', 'the thao', 'ty so tran dau',
  ]
  for (const entry of CHATBOT_SMALL_TALK_SEED) {
    const haystack = plain(`${entry.question} ${entry.answer}`)
    for (const term of forbidden) {
      assert.ok(!haystack.includes(term), `out-of-scope term "${term}" in "${entry.question}"`)
    }
  }
})

test('every answer is non-empty and reasonably substantive', () => {
  for (const entry of CHATBOT_SMALL_TALK_SEED) {
    assert.ok(entry.answer.trim().length >= 20, `answer too thin for "${entry.question}"`)
    assert.ok(entry.question.trim().length > 0)
  }
})
