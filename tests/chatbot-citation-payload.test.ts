import assert from 'node:assert/strict'
import test from 'node:test'

import { toCitationReferences } from '../server/utils/chatbot/serializers.ts'

/**
 * Trích dẫn gửi xuống trình duyệt KHÔNG mang toàn văn điều luật.
 *
 * `PublicKnowledgeReference` có `question` + `answer` vì prompt cần chúng. Gửi nguyên
 * hình dạng đó ra mạng thì mỗi câu trả lời kèm toàn văn mà widget không dùng: đo trên
 * production 2026-11-04 cho câu "Thủ tục xóa án tích như thế nào?", payload 13 309 ký tự
 * và riêng `sources` là 5 772 ký tự (43,4%), trong đó 5 079 ký tự là `answer` của 3
 * nguồn — `normalizeSource` phía client vứt hết, chỉ giữ `entryId`/`label`/`reference`/`url`.
 * Toàn văn đi qua `/api/public/chatbot/sources?id=…` khi khách bấm "Xem".
 */

const reference = {
  id: 11,
  kind: 'knowledge',
  question: 'Việc xoá án tích đối với người chấp hành xong án phạt tù như thế nào?',
  answer: 'Khoản 1 Điều 69 Bộ luật Hình sự quy định: “Người được xóa án tích coi như chưa bị kết án”.'.repeat(20),
  topic: 'legal',
  source: { label: 'Tài liệu Hỏi – Đáp', reference: 'STT 7', url: null },
}

test('a citation keeps the id, kind and label a list needs — and drops the approved text', () => {
  const [citation] = toCitationReferences([reference])

  assert.deepEqual(citation, {
    id: 11,
    kind: 'knowledge',
    source: { label: 'Tài liệu Hỏi – Đáp', reference: 'STT 7', url: null },
  })
  const serialized = JSON.stringify(citation)
  assert.doesNotMatch(serialized, /Bộ luật Hình sự/, 'toàn văn không được đi ra mạng')
  assert.doesNotMatch(serialized, /question/, 'câu hỏi chuẩn cũng không — widget không vẽ nó')
})

test('the payload really shrinks: the approved text is the bulk of a reference', () => {
  const before = JSON.stringify([reference]).length
  const after = JSON.stringify(toCitationReferences([reference])).length
  assert.ok(
    after < before / 5,
    `reference ${before} ký tự → citation ${after}; nếu không giảm mạnh thì toàn văn vẫn còn trong payload`,
  )
})

test('a reference with no source block stays a citation with no source block', () => {
  const [citation] = toCitationReferences([{ ...reference, source: null }])
  assert.deepEqual(citation, { id: 11, kind: 'knowledge', source: null })
})

test('an empty list stays empty (a turn that cites nothing)', () => {
  assert.deepEqual(toCitationReferences([]), [])
})
