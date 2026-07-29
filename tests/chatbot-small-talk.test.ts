import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { matchSmallTalk, plain, normalizeQuestion, type SmallTalkEntry } from '../server/utils/chatbot/small-talk'
import { validateChatbotSettingsUpdate, ChatbotSettingsValidationError } from '../server/utils/chatbot/settings'
import { serializeChatbotSettings } from '../server/utils/chatbot/serializers'

/**
 * `matchSmallTalk` is now a PURE matcher: it takes already-loaded, enabled rows
 * and a query, and returns { id, category, answer } | null. It never touches the
 * database, so these tests drive it with hand-built rows.
 */

function row(overrides: Partial<SmallTalkEntry> & Pick<SmallTalkEntry, 'id'>): SmallTalkEntry {
  return {
    category: 'social',
    answer: `answer-${overrides.id}`,
    patterns: [],
    normalizedQuestion: '',
    isEnabled: true,
    displayOrder: 0,
    ...overrides,
  }
}

const ENTRIES: SmallTalkEntry[] = [
  row({ id: 1, category: 'social', normalizedQuestion: 'xin chào', patterns: ['xin chao', 'chao ban', 'chao'], displayOrder: 0, answer: 'Xin chào anh/chị!' }),
  row({ id: 2, category: 'identity', normalizedQuestion: 'bạn là ai', patterns: ['ban la ai', 'ban ten gi'], displayOrder: 1, answer: 'Tôi là trợ lý ảo.' }),
  row({ id: 3, category: 'social', normalizedQuestion: 'ok', patterns: ['ok', 'oke'], displayOrder: 2, answer: 'Dạ vâng ạ.' }),
  row({ id: 4, category: 'portal_facts', normalizedQuestion: 'dùng cổng này có mất phí không', patterns: ['co mat phi khong', 'mat phi khong', 'co ton phi khong'], displayOrder: 3, answer: 'Cổng thông tin này hoàn toàn miễn phí ạ.' }),
]

// ── tier ordering ─────────────────────────────────────────────────────────────

test('tier 1: an exact normalized question wins (diacritic/case insensitive)', () => {
  for (const q of ['xin chào', 'XIN CHÀO', 'xin chao']) {
    assert.equal(matchSmallTalk(ENTRIES, q)?.id, 1, q)
  }
})

test('tier 2: an exact whole-pattern match', () => {
  assert.equal(matchSmallTalk(ENTRIES, 'chào bạn')?.id, 1)
  assert.equal(matchSmallTalk(ENTRIES, 'bạn tên gì')?.id, 2)
})

test('tier 3: a pattern appearing as a contiguous token run', () => {
  // "chao ban" is a 2-token pattern of entry 1, embedded in a longer message.
  assert.equal(matchSmallTalk(ENTRIES, 'chào bạn nhé')?.id, 1)
})

test('tier 3: the longer pattern wins when several match', () => {
  const rows: SmallTalkEntry[] = [
    row({ id: 10, patterns: ['thong tin'], displayOrder: 0 }),
    row({ id: 11, patterns: ['thong tin ca nhan'], displayOrder: 1 }),
  ]
  assert.equal(matchSmallTalk(rows, 'thông tin cá nhân của tôi có an toàn không')?.id, 11)
})

test('tier 3 tie-break: equal length falls back to displayOrder then id', () => {
  const rows: SmallTalkEntry[] = [
    row({ id: 21, patterns: ['cam on'], displayOrder: 5 }),
    row({ id: 20, patterns: ['cam on'], displayOrder: 2 }),
  ]
  assert.equal(matchSmallTalk(rows, 'tôi cảm ơn cán bộ rất nhiều')?.id, 20, 'lower displayOrder wins')
})

// ── the fee question the old hard gate used to drop ─────────────────────────────

test('an 11-word everyday fee question still matches', () => {
  const q = 'cho tôi hỏi dùng dịch vụ này có mất phí không ạ'
  assert.equal(matchSmallTalk(ENTRIES, q)?.id, 4)
})

// ── precision guards ────────────────────────────────────────────────────────────

test('a business question with no everyday phrase is not claimed as small talk', () => {
  // The matcher only fires when an everyday phrase appears as a contiguous run.
  // A pure business question contains none, so it returns null and the caller
  // falls through to the knowledge / lead-capture path.
  const q = 'thủ tục xóa án tích cần những giấy tờ gì'
  assert.equal(matchSmallTalk(ENTRIES, q), null)
})

test('a business question that OPENS with a greeting is guarded at the policy layer, not the matcher', () => {
  // Documented, deliberate behaviour: "xin chào ..." embeds the greeting phrase as
  // a contiguous run, so the matcher DOES return the greeting entry. It is the
  // policy layer that keeps this safe — the approved bank is retrieved first and
  // always wins, so the matcher is never even consulted for such a turn (see
  // tests/chatbot-small-talk-policy.test.ts, "the approved bank wins").
  const q = 'xin chào tôi muốn hỏi thủ tục xóa án tích cần giấy tờ gì'
  assert.equal(matchSmallTalk(ENTRIES, q)?.id, 1)
})

test('short single-word patterns match only as the whole message', () => {
  assert.equal(matchSmallTalk(ENTRIES, 'ok')?.id, 3)
  assert.equal(matchSmallTalk(ENTRIES, 'oke')?.id, 3)
  // "ok" buried in a sentence must not fire (SHORT_WORD_MAX rule).
  assert.equal(matchSmallTalk(ENTRIES, 'cho tôi hỏi ok là như thế nào'), null)
})

test('short bare greeting still matches (tier 2 whole-message)', () => {
  // "chao" is a 1-token ≤4-char pattern; it matches as the whole message via tier 2,
  // but must not fire inside a longer sentence.
  assert.equal(matchSmallTalk(ENTRIES, 'chào')?.id, 1)
  assert.equal(matchSmallTalk(ENTRIES, 'tôi chào cờ mỗi sáng thứ hai'), null)
})

test('disabled rows never match', () => {
  const rows: SmallTalkEntry[] = [row({ id: 30, normalizedQuestion: 'xin chào', patterns: ['xin chao'], isEnabled: false })]
  assert.equal(matchSmallTalk(rows, 'xin chào'), null)
  assert.equal(matchSmallTalk(rows, 'xin chao'), null)
})

test('empty, whitespace, non-string, and empty-array input return null (never throw)', () => {
  for (const value of [null, undefined, 42, {}, [], '', '   ', '\n']) {
    assert.equal(matchSmallTalk(ENTRIES, value as unknown), null)
  }
  assert.equal(matchSmallTalk([], 'xin chào'), null, 'no rows means no match')
})

test('an over-length message is dropped by the safety ceiling', () => {
  assert.equal(matchSmallTalk(ENTRIES, 'xin chào '.repeat(40)), null, 'a flood of greetings is not a greeting turn')
})

// ── shared normalization helpers ────────────────────────────────────────────────

test('plain() strips diacritics, folds đ→d, and turns punctuation into spaces', () => {
  assert.equal(plain('Xin Chào, Bạn!'), 'xin chao ban')
  assert.equal(plain('Đường dây nóng'), 'duong day nong')
  assert.equal(plain('   '), '')
})

test('normalizeQuestion() keeps diacritics, lowercases, collapses whitespace, caps at 191', () => {
  assert.equal(normalizeQuestion('  Xin   CHÀO  '), 'xin chào')
  assert.equal(normalizeQuestion('a'.repeat(300)).length, 191)
})

// ── settings plumbing (pre-existing smallTalkEnabled toggle) ─────────────────────

test('smallTalkEnabled is validated as a boolean and refuses anything else', () => {
  assert.doesNotThrow(() => validateChatbotSettingsUpdate({ smallTalkEnabled: false }))
  assert.throws(() => validateChatbotSettingsUpdate({ smallTalkEnabled: 'yes' as never }), ChatbotSettingsValidationError)
})

test('the serializer exposes the toggle and defaults a missing value to on', () => {
  assert.equal(serializeChatbotSettings({ smallTalkEnabled: false } as never).smallTalkEnabled, false)
  assert.equal(serializeChatbotSettings({} as never).smallTalkEnabled, true)
})

test('the admin form and the public widget both know the small-talk field', () => {
  const form = readFileSync(new URL('../app/pages/admin/chatbot/settings.vue', import.meta.url), 'utf8')
  assert.match(form, /v-model="form\.smallTalkEnabled"/u)
  assert.match(form, /smallTalkEnabled: form\.smallTalkEnabled/u)

  const layout = readFileSync(new URL('../app/layouts/default.vue', import.meta.url), 'utf8')
  assert.match(layout, /'small_talk'/u, 'the widget must accept the small_talk response kind')
})
