/**
 * What the REAL instant moderation decides for a chat request, through both public handlers
 * (harness: `tests/_chat-real-moderation.ts` — only the database, the AI gateway and the chat
 * plumbing around moderation are faked).
 *
 * The contract (rà soát 2026-10-23, `chat-turns.ts`): the NEW question is screened first —
 * a hit refuses the request and files exactly one review-queue row; an EARLIER user turn that
 * trips a rule is only withheld from the model — no refusal, no review row; the bot's own
 * turns are never screened. Written BEFORE the history turns moved from one
 * `matchInstantRule` call per turn to one batched pass (wave3 4.3c follow-up): green on the
 * per-turn loop and on the batch — the batch must not change a single decision or row.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { HANDLERS, answeredUserTexts, kindOf, publicHandler, reset, rule, send, state } from './_chat-real-moderation.ts'

const RULES = () => [
  rule('lô\\s*đề'),
  rule('cá độ', 'keyword'),
  rule('(?:0|\\+84)\\d{9}'),
]

for (const [name, handler] of HANDLERS) {
  test(`${name}: a newest turn that trips a database rule is refused and filed once`, async () => {
    reset(RULES())
    const reply = await send(handler, [
      { role: 'user', content: 'xin chào' },
      { role: 'assistant', content: 'Chào bạn.' },
      { role: 'user', content: 'chơi lô đề ở đâu' },
    ])
    assert.equal(kindOf(reply), 'moderation_blocked')
    assert.equal(state.answered.length, 0, 'the model is never asked')
    assert.equal(state.queue.length, 1, 'one review row')
    assert.equal(state.queue[0]!.contentSnippet, 'chơi lô đề ở đâu')
    assert.deepEqual(state.queue[0]!.matchedRules, ['[Chặn tức thì - cat-lô\\s*đề] Mẫu regex: lô\\s*đề'])
  })

  test(`${name}: earlier turns that trip a rule (regex, keyword, built-in) are withheld — no refusal, no review row`, async () => {
    reset(RULES())
    const reply = await send(handler, [
      { role: 'user', content: 'gọi 0912345678 nhé' },
      { role: 'assistant', content: 'Vâng.' },
      { role: 'user', content: 'có kèo cá độ không' },
      { role: 'assistant', content: 'Không.' },
      { role: 'user', content: 'mày dcm' },
      { role: 'assistant', content: 'Xin giữ lịch sự.' },
      { role: 'user', content: 'thủ tục xoá án tích thế nào' },
      { role: 'assistant', content: 'Như sau…' },
      { role: 'user', content: 'cảm ơn' },
    ])
    assert.notEqual(kindOf(reply), 'moderation_blocked')
    assert.equal(state.queue.length, 0, 'an earlier turn never files a row')
    assert.deepEqual(answeredUserTexts(), ['thủ tục xoá án tích thế nào', 'cảm ơn'], 'exactly the flagged turns are withheld')
  })

  test(`${name}: a repeated earlier turn is withheld every time it appears; the bot's own turns are never screened`, async () => {
    reset(RULES())
    await send(handler, [
      { role: 'user', content: 'chơi lô đề' },
      { role: 'assistant', content: 'Lô đề là hành vi đánh bạc trái phép.' },
      { role: 'user', content: 'chơi lô đề' },
      { role: 'assistant', content: 'Như trên.' },
      { role: 'user', content: 'hiểu rồi' },
    ])
    assert.equal(state.queue.length, 0)
    const sent = state.answered.at(-1) as Array<{ role: string, content: string }>
    assert.deepEqual(sent.map(turn => [turn.role, turn.content]), [
      ['assistant', 'Lô đề là hành vi đánh bạc trái phép.'],
      ['assistant', 'Như trên.'],
      ['user', 'hiểu rồi'],
    ])
  })

  test(`${name}: a clean conversation reaches the model whole`, async () => {
    reset(RULES())
    const history = Array.from({ length: 15 }, (_, i) => ({ role: 'user', content: `câu hỏi số ${i} về thủ tục` }))
    await send(handler, history)
    assert.equal(state.queue.length, 0)
    assert.deepEqual(answeredUserTexts(), history.map(turn => turn.content))
  })

  test(`${name}: no database rules (or none loadable) — the built-ins still screen every user turn`, async () => {
    reset([])
    await send(handler, [{ role: 'user', content: 'đồ óc chó' }, { role: 'user', content: 'tài xỉu online' }, { role: 'user', content: 'bình thường' }])
    assert.equal(state.queue.length, 0)
    assert.deepEqual(answeredUserTexts(), ['bình thường'])
    reset([])
    assert.equal(kindOf(await send(handler, [{ role: 'user', content: 'bình thường' }, { role: 'user', content: 'đồ óc chó' }])), 'moderation_blocked')
    assert.equal(state.queue.length, 1)
  })
}

test('/api/public/chatbot: when the newest turn is refused the history is not screened, and the refused turn is the one stored', async () => {
  reset(RULES())
  const reply = await send(publicHandler, [{ role: 'user', content: 'gọi 0912345678' }, { role: 'user', content: 'chơi lô đề' }])
  assert.equal(kindOf(reply), 'moderation_blocked')
  assert.equal(state.queue.length, 1, 'only the newest turn is filed')
  assert.equal(state.queue[0]!.contentSnippet, 'chơi lô đề')
  assert.deepEqual(state.persisted, ['chơi lô đề'])
})
