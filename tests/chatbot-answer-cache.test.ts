/**
 * Cache câu trả lời của model.
 *
 * Ba bất biến phải cùng đúng, nếu không thì "tiết kiệm" là phát tán câu trả lời sai:
 *  1. Khoá gồm **phiên bản dữ liệu** — sửa kho kiến thức / small-talk / bài viết / cấu
 *     hình AI là câu cũ không bao giờ được phát lại, và không ai phải nhớ đi xoá.
 *  2. Khoá gồm **cấu hình đang chạy** — đổi model hay system prompt thì câu của model cũ
 *     không được phát lại.
 *  3. Lượt có **ngữ cảnh nhiều câu** và câu **chạm chủ quyền biển đảo** không bao giờ cache.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ANSWER_CACHE_MAX_ROWS,
  ANSWER_CACHE_TTL_DAYS,
  answerCacheKey,
} from '../server/services/chatbot-answer-cache.ts'

const SETTINGS = {
  mode: 'ai',
  outOfScopeBehavior: 'ai_freeform',
  model: 'delify-5.5',
  baseUrl: 'https://router.delify.vn/v1',
  systemPrompt: 'Chỉ trả lời theo tài liệu đã duyệt.',
}

const key = (over: Partial<Parameters<typeof answerCacheKey>[0]> = {}) =>
  answerCacheKey({ question: 'Làm sao để xóa án tích?', settings: SETTINGS, version: 1, historyLength: 1, ...over })

test('the same question, data version and configuration give the same key', () => {
  assert.equal(key(), key())
  assert.match(key()!, /^[0-9a-f]{64}$/u)
})

test('diacritics, case and punctuation do not split the cache', () => {
  // Cùng một câu gõ ba kiểu phải trúng cùng một hàng, nếu không cache gần như vô dụng
  // với người gõ không dấu.
  const base = key({ question: 'Làm sao để xóa án tích?' })
  assert.equal(key({ question: 'lam sao de xoa an tich' }), base)
  assert.equal(key({ question: '  LÀM SAO để XÓA án tích  ' }), base)
})

test('a new data version makes the old key unreachable', () => {
  assert.notEqual(key({ version: 1 }), key({ version: 2 }))
})

test('changing the model, the endpoint, the prompt, the mode or the out-of-scope rule changes the key', () => {
  const base = key()
  assert.notEqual(key({ settings: { ...SETTINGS, model: 'another-model' } }), base, 'model')
  assert.notEqual(key({ settings: { ...SETTINGS, baseUrl: 'https://other.example/v1' } }), base, 'endpoint')
  assert.notEqual(key({ settings: { ...SETTINGS, systemPrompt: 'prompt khác' } }), base, 'system prompt')
  assert.notEqual(key({ settings: { ...SETTINGS, mode: 'knowledge' } }), base, 'mode')
  assert.notEqual(key({ settings: { ...SETTINGS, outOfScopeBehavior: 'knowledge_only' } }), base, 'out-of-scope rule')
})

test('a turn with conversation history is never cached', () => {
  // Câu trả lời khi đó phụ thuộc các lượt trước; một khoá theo câu hỏi hiện tại sẽ trả
  // lời sai ngữ cảnh cho người khác hỏi cùng câu đó.
  for (const historyLength of [2, 3, 8]) assert.equal(key({ historyLength }), null, `history ${historyLength}`)
})

test('a blank question is never cached', () => {
  for (const question of ['', '   ', '?!…']) assert.equal(key({ question }), null, JSON.stringify(question))
})

test('the two limits the service enforces are named constants, not magic numbers', () => {
  assert.ok(Number.isInteger(ANSWER_CACHE_TTL_DAYS) && ANSWER_CACHE_TTL_DAYS > 0)
  assert.ok(Number.isInteger(ANSWER_CACHE_MAX_ROWS) && ANSWER_CACHE_MAX_ROWS > 1000)
})
