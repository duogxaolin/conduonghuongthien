import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

/**
 * Ranker ngữ nghĩa small-talk cho một lượt hỏi (`semanticProviderForTurn`, `server/utils/chatbot/chat.ts`).
 *
 * Lỗi gốc (2026-11-06): tiến trình vừa khởi động chưa cài ranker nào (ranker chỉ được cài khi kho small-talk được
 * nạp — SAU lúc lượt hỏi lấy provider ra), nên lượt hỏi đầu bỏ qua lớp ngữ nghĩa; câu rơi xuống model và được
 * cache, che mục small-talk khớp ngữ nghĩa tới 30 ngày.
 */
mock.module('../server/utils/db', { namedExports: { getDb: () => ({}), getPool: () => null } })

const { semanticProviderForTurn } = await import('../server/utils/chatbot/chat')
const { installSmallTalkSemanticProvider } = await import('../server/utils/chatbot/small-talk-semantic')

const CANDIDATES = [
  { id: 1, intent: null, category: 'social', semanticExamples: ['xin chao', 'chao ban'] },
  { id: 4, intent: null, category: 'social', semanticExamples: ['cam on', 'cam on nhieu'] },
]

test('a fresh process (no ranker installed yet) still ranks the candidates of the first question', async () => {
  installSmallTalkSemanticProvider(null)
  const provider = semanticProviderForTurn()
  assert.ok(provider, 'the first question after boot must not skip the semantic layer')
  const scores = await provider.rank({ query: 'cam on nhieu lam', candidates: CANDIDATES, signal: new AbortController().signal })
  assert.equal([...scores].sort((left, right) => right.confidence - left.confidence)[0]!.entryId, 4)
})

test('an installed ranker is the one used', () => {
  const installed = { rank: async () => [] }
  installSmallTalkSemanticProvider(installed)
  try {
    assert.equal(semanticProviderForTurn(), installed)
  } finally {
    installSmallTalkSemanticProvider(null)
  }
})
