/**
 * Ranker trigram cho small-talk — lớp thứ ba, chỉ chạy khi kho nghiệp vụ và bộ luật tất
 * định đều không khớp.
 *
 * Số đo dùng ở đây (kho 122 mục của `cdkt_ai_qa`, 23 câu cần bắt + 12 câu lạc đề, đo
 * 2026-11-04) là lý do ranker tồn tại và cũng là ràng buộc của nó:
 *   luật tất định                bắt 15/23, lọt 0
 *   luật + trigram @0.65         bắt 18/23, lọt 0
 * Bốn câu còn sót phải thêm MẪU vào kho, không phải hạ ngưỡng: ở 0.5 ranker bắt 22/23
 * nhưng lọt 4/12 câu nghiệp vụ, tức là chào lại người đang hỏi thủ tục xoá án tích.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  SMALL_TALK_TRIGRAM_DEFAULTS,
  createTrigramRanker,
  normalizeForTrigram,
} from '../server/utils/chatbot/small-talk-semantic-trigram.ts'
import { selectSmallTalk, type SemanticSmallTalkEntry } from '../server/utils/chatbot/small-talk-semantic.ts'

function entry(id: number, examples: string[]): SemanticSmallTalkEntry {
  return { id, intent: null, category: 'social', semanticExamples: examples }
}

/** Bốn mục lấy đúng mẫu của kho thật — đủ để phân biệt ranker tốt với ranker hỏng. */
const BANK: SemanticSmallTalkEntry[] = [
  entry(1, ['xin chao', 'chao ban', 'hi', 'hello']),
  entry(4, ['cam on', 'cam on ban', 'cam on nhieu', 'thanks']),
  entry(5, ['tam biet', 'chao tam biet', 'hen gap lai', 'bye', 'goodbye']),
  entry(19, ['chuc buoi toi vui ve', 'chuc ngu ngon', 'chuc toi vui']),
]

const rank = async (query: string) => {
  const scores = await createTrigramRanker(BANK).rank({ query, candidates: BANK, signal: new AbortController().signal })
  return [...scores].sort((left, right) => right.confidence - left.confidence)
}

test('normalisation strips diacritics, case and punctuation the same way for query and bank', () => {
  assert.equal(normalizeForTrigram('  Chúc NGỦ ngon, nhé!  '), 'chuc ngu ngon nhe')
  assert.equal(normalizeForTrigram('ĐÃ cảm ơn'), 'da cam on')
})

test('a typo and an abbreviation still score above the shipped threshold', async () => {
  const [helo] = await rank('helo')
  assert.ok(helo!.confidence >= SMALL_TALK_TRIGRAM_DEFAULTS.confidenceThreshold, `helo → ${helo!.confidence}`)
  const [thanks] = await rank('thank you')
  assert.ok(thanks!.confidence >= 0.5, `thank you → ${thanks!.confidence}`)
})

test('an unrelated business question scores below the threshold on every entry', async () => {
  for (const query of ['Xóa án tích cần gì?', 'Học nghề miễn phí ở đâu?', 'Tôi muốn đăng ký cư trú ở địa phương']) {
    const scores = await rank(query)
    const best = scores[0]!
    assert.ok(best.confidence < SMALL_TALK_TRIGRAM_DEFAULTS.confidenceThreshold,
      `"${query}" phải dưới ngưỡng, thấy ${best.confidence.toFixed(3)} trên mục ${best.entryId}`)
  }
})

test('the selector accepts a trigram match only after the rule matcher has declined', async () => {
  const ranker = createTrigramRanker(BANK)
  const config = { enabled: true, ...SMALL_TALK_TRIGRAM_DEFAULTS }
  const select = (query: string, ruleMatcher: (entries: readonly SemanticSmallTalkEntry[], value: unknown) => { id: number } | null) =>
    selectSmallTalk({ businessReferences: [], entries: BANK, query, ruleMatcher, semanticProvider: ranker, semanticConfig: config })

  // Luật khớp trước ⇒ confidence 1 và KHÔNG gọi ranker (provider dưới đây sẽ ném nếu bị gọi).
  const exploding = { rank: async () => { throw new Error('ranker must not run when the rule matched') } }
  const rule = await selectSmallTalk({
    businessReferences: [], entries: BANK, query: 'hello',
    ruleMatcher: () => ({ id: 1 }), semanticProvider: exploding, semanticConfig: config,
  })
  assert.equal(rule?.confidence, 1)
  assert.equal(rule?.entryId, 1)

  // Luật không khớp ⇒ ranker quyết định.
  const semantic = await select('helo', () => null)
  assert.equal(semantic?.entryId, 1, 'helo ~ hello')

  // Kho nghiệp vụ khớp ⇒ small-talk im lặng, kể cả khi ranker sẽ khớp.
  const business = await selectSmallTalk({
    businessReferences: [{ id: 99 }], entries: BANK, query: 'helo',
    ruleMatcher: () => null, semanticProvider: ranker, semanticConfig: config,
  })
  assert.equal(business, null)
})

test('the index only holds entries that carry examples, and the answer is never part of the index', async () => {
  const withAnswer = { ...entry(9, ['xin chao']), answer: 'BÍ MẬT-KHÔNG-ĐƯỢC-VÀO-CHỈ-MỤC' } as SemanticSmallTalkEntry & { answer: string }
  const bare = { id: 10, intent: null, category: 'social', semanticExamples: [] } as SemanticSmallTalkEntry
  const ranker = createTrigramRanker([withAnswer, bare])
  assert.equal(ranker.size, 1, 'mục không có ví dụ không vào chỉ mục')
  const scores = await ranker.rank({ query: 'BÍ MẬT', candidates: [withAnswer, bare], signal: new AbortController().signal })
  assert.deepEqual(scores.map(score => score.entryId), [9], 'mục không có ví dụ không bao giờ được trả điểm')
})

test('with the shipped threshold the ranker adds matches the rules alone never reached', async () => {
  // Đo đầu-cuối qua `answerChat` (2026-11-04, `cdkt_ai_qa`, 26 câu chào + 20 câu nghiệp vụ):
  //   TẮT semantic  16/26 câu chào vào small_talk, 0/20 câu nghiệp vụ lọt
  //   BẬT semantic  19/26 câu chào vào small_talk, 0/20 câu nghiệp vụ lọt
  // Sáu câu còn sót bị KHO NGHIỆP VỤ bắt trước ("tạm biệt" khớp `tam` của "tâm lý"), nên
  // đây là phép kiểm của ranker, không phải của toàn tuyến: chọn thẳng từ danh sách mục.
  const ranker = createTrigramRanker(BANK)
  const config = { enabled: true, ...SMALL_TALK_TRIGRAM_DEFAULTS }
  const select = (query: string) => selectSmallTalk({
    businessReferences: [], entries: BANK, query, ruleMatcher: () => null,
    semanticProvider: ranker, semanticConfig: config,
  })
  assert.equal((await select('helo'))?.entryId, 1, 'gõ thiếu ký tự vẫn tới mục chào')
  assert.equal((await select('cám ơn bạn nhiều'))?.entryId, 4, 'câu dài hơn mẫu vẫn tới mục cảm ơn')
  assert.equal(await select('Học nghề miễn phí ở đâu?'), null, 'câu nghiệp vụ không được thành lời chào')
})
