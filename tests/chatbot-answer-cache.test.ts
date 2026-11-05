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
  parseCachedSources,
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

/**
 * Hàng cache ghi TRƯỚC 2026-11-05 mang `PublicKnowledgeReference` đầy đủ (có `answer`).
 * Cache sống hàng ngày, nên đọc lại phải chiếu về hình dạng hiện tại — nếu không, mọi
 * câu phát lại vẫn kèm toàn văn điều luật. Đo trên production ngay sau deploy bản vá:
 * bản miss có `sources` 215 ký tự, bản hit (hàng cũ) 5 812 ký tự, `answer` vẫn ở trong.
 */
test('a cached row written before the citation cut is narrowed when read back', () => {
  const legacy = [{
    id: 11,
    kind: 'knowledge',
    question: 'Việc xoá án tích đối với người chấp hành xong án phạt tù như thế nào?',
    answer: 'Khoản 1 Điều 69 Bộ luật Hình sự: người được xóa án tích coi như chưa bị kết án.',
    topic: 'general',
    source: { label: 'Tài liệu Hỏi – Đáp', reference: 'STT 7', url: null },
  }]

  const [citation] = parseCachedSources(legacy)
  assert.deepEqual(citation, {
    id: 11,
    kind: 'knowledge',
    source: { label: 'Tài liệu Hỏi – Đáp', reference: 'STT 7', url: null },
  })
  assert.doesNotMatch(JSON.stringify(citation), /Bộ luật Hình sự/u, 'toàn văn không được rò ra mạng qua đường cache')
})

test('a malformed cached row is dropped, not passed through', () => {
  // Cột JSON trong DB không được ràng buộc kiểu; hàng rác không được thành trích dẫn.
  assert.deepEqual(parseCachedSources(null), [])
  assert.deepEqual(parseCachedSources([null, 3, 'x', { kind: 'knowledge' }, { id: 'a', kind: 'b' }]), [])
  assert.deepEqual(parseCachedSources([{ id: 4, kind: 'knowledge' }]), [{ id: 4, kind: 'knowledge', source: null }])
})
