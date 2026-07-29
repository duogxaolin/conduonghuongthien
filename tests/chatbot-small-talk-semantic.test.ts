import assert from 'node:assert/strict'
import test from 'node:test'
import {
  readSmallTalkSemanticConfig,
  selectSmallTalk,
  SMALL_TALK_SEMANTIC_DEFAULTS,
  type SemanticSmallTalkEntry,
  type SemanticSmallTalkProvider,
} from '../server/utils/chatbot/small-talk-semantic'

type Entry = SemanticSmallTalkEntry & { answer: string }

const entries: Entry[] = [
  { id: 1, intent: 'greeting', category: 'social', semanticExamples: ['xin chào', 'chào bạn'], answer: 'trusted greeting' },
  { id: 2, intent: 'gratitude', category: 'social', semanticExamples: ['cảm ơn bạn'], answer: 'trusted thanks' },
  { id: 3, intent: null, category: 'navigation', semanticExamples: ['tìm mục văn bản'], answer: 'trusted navigation' },
]

const noRuleMatch = () => null
const enabled = { enabled: true, confidenceThreshold: 0.8, top1Top2Margin: 0.1, timeoutMs: 50 }

function provider(scores: { entryId: number; confidence: number }[]) {
  const calls = { count: 0, candidates: [] as readonly SemanticSmallTalkEntry[] }
  const value: SemanticSmallTalkProvider = {
    rank: async ({ candidates }) => {
      calls.count++
      calls.candidates = candidates
      return scores
    },
  }
  return { calls, value }
}

test('semantic runtime is disabled by default and requires no provider', async () => {
  assert.deepEqual(readSmallTalkSemanticConfig({}), SMALL_TALK_SEMANTIC_DEFAULTS)

  let ruleCalls = 0
  const result = await selectSmallTalk({
    businessReferences: [],
    entries,
    query: 'một cách nói khác',
    ruleMatcher: () => { ruleCalls++; return null },
  })

  assert.equal(result, null)
  assert.equal(ruleCalls, 1)
})

test('business retrieval always wins before rule and semantic matching', async () => {
  const semantic = provider([{ entryId: 1, confidence: 0.99 }])
  let ruleCalls = 0

  const result = await selectSmallTalk({
    businessReferences: [{ id: 99 }],
    entries,
    query: 'xin chào',
    ruleMatcher: () => { ruleCalls++; return { id: 1 } },
    semanticProvider: semantic.value,
    semanticConfig: enabled,
  })

  assert.equal(result, null)
  assert.equal(ruleCalls, 0)
  assert.equal(semantic.calls.count, 0)
})

test('obvious short deterministic matches return immediately without waiting on local AI', async () => {
  const semantic = provider([{ entryId: 2, confidence: 0.99 }])

  for (const [query, id] of [['hi', 1], ['ok', 2]] as const) {
    const result = await selectSmallTalk({
      businessReferences: [],
      entries,
      query,
      ruleMatcher: (_entries, value) => value === query ? { id } : null,
      semanticProvider: semantic.value,
      semanticConfig: enabled,
    })
    assert.deepEqual(result, {
      entryId: id,
      intent: entries.find(entry => entry.id === id)!.intent,
      category: 'social',
      confidence: 1,
    })
  }

  assert.equal(semantic.calls.count, 0)
})

test('semantic match returns trusted entry metadata only after threshold and margin pass', async () => {
  const semantic = provider([
    { entryId: 2, confidence: 0.84 },
    { entryId: 1, confidence: 0.96 },
  ])

  const result = await selectSmallTalk({
    businessReferences: [],
    entries,
    query: 'lời mở đầu thân thiện',
    ruleMatcher: noRuleMatch,
    semanticProvider: semantic.value,
    semanticConfig: enabled,
  })

  assert.deepEqual(result, { entryId: 1, intent: 'greeting', category: 'social', confidence: 0.96 })
  assert.equal('answer' in result!, false)
  assert.deepEqual(semantic.calls.candidates, entries)
})

test('semantic threshold and top1-top2 margin reject uncertain matches', async () => {
  for (const scores of [
    [{ entryId: 1, confidence: 0.79 }],
    [{ entryId: 1, confidence: 0.91 }, { entryId: 2, confidence: 0.82 }],
  ]) {
    const semantic = provider(scores)
    const result = await selectSmallTalk({
      businessReferences: [],
      entries,
      query: 'câu nói mơ hồ',
      ruleMatcher: noRuleMatch,
      semanticProvider: semantic.value,
      semanticConfig: enabled,
    })
    assert.equal(result, null)
  }
})

test('unknown IDs, malformed scores, provider errors and unavailable runtime fail closed', async () => {
  for (const semanticProvider of [
    provider([{ entryId: 999, confidence: 0.99 }]).value,
    provider([{ entryId: 1, confidence: Number.NaN }]).value,
    { rank: async () => { throw new Error('runtime unavailable') } },
    null,
  ]) {
    const result = await selectSmallTalk({
      businessReferences: [],
      entries,
      query: 'câu không khớp luật',
      ruleMatcher: noRuleMatch,
      semanticProvider,
      semanticConfig: enabled,
    })
    assert.equal(result, null)
  }
})

test('bounded timeout aborts a slow provider and falls back to no match', async () => {
  let aborted = false
  const slowProvider: SemanticSmallTalkProvider = {
    rank: ({ signal }) => new Promise((resolve) => {
      signal.addEventListener('abort', () => {
        aborted = true
        resolve([{ entryId: 1, confidence: 0.99 }])
      }, { once: true })
    }),
  }

  const startedAt = Date.now()
  const result = await selectSmallTalk({
    businessReferences: [],
    entries,
    query: 'cách nói chưa biết',
    ruleMatcher: noRuleMatch,
    semanticProvider: slowProvider,
    semanticConfig: { ...enabled, timeoutMs: 15 },
  })

  assert.equal(result, null)
  assert.equal(aborted, true)
  assert.ok(Date.now() - startedAt < 500)
})

test('environment contract is opt-in and bounded', () => {
  assert.deepEqual(readSmallTalkSemanticConfig({
    CHATBOT_SMALL_TALK_SEMANTIC_ENABLED: '1',
    CHATBOT_SMALL_TALK_SEMANTIC_CONFIDENCE: '2',
    CHATBOT_SMALL_TALK_SEMANTIC_MARGIN: '-1',
    CHATBOT_SMALL_TALK_SEMANTIC_TIMEOUT_MS: '999999',
  }), {
    enabled: true,
    confidenceThreshold: 1,
    top1Top2Margin: 0,
    timeoutMs: 2_000,
  })
})
