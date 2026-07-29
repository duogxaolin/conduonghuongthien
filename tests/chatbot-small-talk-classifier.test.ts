import assert from 'node:assert/strict'
import test from 'node:test'
import { CHATBOT_SMALL_TALK_SEED } from '../server/data/chatbot-small-talk-seed'
import { classifySmallTalk, matchSmallTalk, normalizeQuestion, type SmallTalkEntry } from '../server/utils/chatbot/small-talk'

function row(id: number, category: string, question: string, patterns: string[], answer = `db-answer-${id}`): SmallTalkEntry {
  return { id, category, normalizedQuestion: question, patterns, answer, isEnabled: true, displayOrder: id }
}

const entries: SmallTalkEntry[] = [
  row(1, 'social', 'Xin chào', ['hi', 'hello', 'xin chao']),
  row(2, 'social', 'Cảm ơn', ['cam on', 'thanks']),
  row(3, 'social', 'Được rồi', ['duoc roi', 'ok', 'ừ', 'dạ']),
  row(4, 'social', 'Tạm biệt', ['bye', 'goodbye', 'tam biet']),
  row(5, 'social', 'Hay quá', ['hay qua', 'tuyet', 'hay']),
  row(6, 'social', 'Bạn làm phiền tôi', ['lam phien qua', 'cham qua']),
  row(7, 'identity', 'Bạn là ai', ['ban la ai']),
  row(8, 'identity', 'Bạn làm được gì', ['ban lam duoc gi']),
  row(9, 'navigation', 'Tìm mô hình', ['tim mo hinh o dau']),
  row(10, 'portal_facts', 'Cổng có mất phí không', ['co mat phi khong']),
  row(11, 'support', 'Tôi buồn', ['toi buon qua']),
]

const seededEntries: SmallTalkEntry[] = CHATBOT_SMALL_TALK_SEED.map((entry, index) => ({
  id: index + 1,
  category: entry.category,
  answer: entry.answer,
  patterns: entry.patterns,
  normalizedQuestion: normalizeQuestion(entry.question),
  isEnabled: true,
  displayOrder: index,
}))

test('classifies every required intent without manufacturing the answer', () => {
  const cases: Array<[string, string]> = [
    ['hi', 'greeting'], ['cảm ơn', 'thanks'], ['ừ', 'acknowledgement'],
    ['bye', 'goodbye'], ['hay quá', 'praise'], ['trả lời chậm quá', 'complaint'],
    ['bạn là ai', 'identity'], ['bạn làm được gì', 'capability'],
    ['tìm mô hình ở đâu', 'navigation'], ['cổng có mất phí không', 'portal_facts'],
    ['tôi buồn quá', 'support'],
  ]
  for (const [query, intent] of cases) {
    const result = classifySmallTalk(entries, query)
    assert.equal(result?.intent, intent, query)
    assert.equal(result?.answer, entries.find(entry => entry.id === result?.id)?.answer, 'answer must come from DB row')
  }
})

test('the shipped DB seed covers every required short intent', () => {
  const cases: Array<[string, string]> = [
    ['hi', 'greeting'], ['hello', 'greeting'], ['ok', 'acknowledgement'],
    ['ừ', 'acknowledgement'], ['dạ', 'acknowledgement'], ['được rồi', 'acknowledgement'],
    ['cảm ơn', 'thanks'], ['bye', 'goodbye'], ['hay', 'praise'],
    ['hay quá', 'praise'], ['tuyệt', 'praise'],
  ]
  for (const [query, intent] of cases) {
    const result = classifySmallTalk(seededEntries, query)
    assert.equal(result?.intent, intent, query)
    assert.ok(result?.answer && CHATBOT_SMALL_TALK_SEED.some(entry => entry.answer === result.answer), `${query} must select a seed answer`)
  }
})

test('legacy goodbye and praise aliases remain available', () => {
  assert.equal(classifySmallTalk(seededEntries, 'mình đi nhé')?.intent, 'goodbye')
  assert.equal(classifySmallTalk(seededEntries, 'làm tốt lắm')?.intent, 'praise')
})

test('hay is praise only as a short standalone phrase, never inside a longer sentence', () => {
  assert.equal(classifySmallTalk(entries, 'hay')?.intent, 'praise')
  assert.equal(classifySmallTalk(entries, 'hay quá')?.intent, 'praise')
  assert.equal(matchSmallTalk(entries, 'hay là tôi cần giấy tờ gì'), null)
  assert.equal(matchSmallTalk(entries, 'có hay không'), null)
  assert.equal(matchSmallTalk(entries, 'tôi hay gặp khó khăn'), null)
})

test('short acknowledgement and thanks do not capture business queries', () => {
  assert.equal(matchSmallTalk(entries, 'được'), null)
  assert.equal(matchSmallTalk(entries, 'tôi có được vay vốn không'), null)
  assert.equal(matchSmallTalk(entries, 'cảm ơn, cho tôi hỏi thủ tục xóa án tích'), null)
})

test('a bounded previous-turn context can clarify a matched generic social row', () => {
  const generic = [row(12, 'social', 'Vậy à', ['vậy à'])]
  assert.equal(classifySmallTalk(generic, 'vậy à')?.intent, 'greeting')
  assert.equal(classifySmallTalk(generic, 'vậy à', { previousIntent: 'goodbye' })?.intent, 'acknowledgement')
  assert.equal(classifySmallTalk(generic, 'thủ tục xóa án tích', { previousIntent: 'goodbye' }), null)
})

test('disabled DB rows cannot become intents', () => {
  assert.equal(classifySmallTalk([{ ...entries[0]!, isEnabled: false }], 'hi'), null)
})
