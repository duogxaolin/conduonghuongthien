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
import test, { mock } from 'node:test'
import { HANDLERS, answeredUserTexts, kindOf, moderationRegex, publicHandler, reset, rule, send, state } from './_chat-real-moderation.ts'

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

// ── The request's regex budget runs out in the history (verify of 4.3c follow-up, W5) ─────────

type LogLine = Record<string, unknown>
async function captureLogs<T>(run: () => Promise<T>): Promise<{ value: T, lines: LogLine[] }> {
  const lines: LogLine[] = []
  const spy = mock.method(console, 'error', (line: unknown) => {
    try { lines.push(JSON.parse(String(line)) as LogLine) } catch { /* not a log line */ }
  })
  try {
    return { value: await run(), lines }
  } finally {
    spy.mock.restore()
  }
}

/**
 * A clock that moves `stepMs` on every reading: every window "costs" 2 × `stepMs`, so the request
 * budget (250 ms) runs out after a fixed, small number of windows — deterministic, no slow regex
 * needed. Real crafted input does the same (`moderation-regex-total-bound.test.ts`, "(b) … withheld").
 */
function steppingClock(stepMs: number): void {
  let t = 0
  moderationRegex.setModerationRegexTimingForTests({ elapsed: () => (t += stepMs), now: () => 1_000_000 })
}

for (const [name, handler] of HANDLERS) {
  test(`${name}: earlier turns the request budget never reached are WITHHELD from the model — a violating one among them never gets through, and files no row`, async () => {
    reset(RULES())
    steppingClock(5)
    const violating = 'chơi lô đề ở đâu'
    const messages = [
      { role: 'user', content: violating }, // the OLDEST turn: scanned last, after the budget is gone
      ...Array.from({ length: 28 }, (_, i) => ({ role: 'user', content: `câu hỏi số ${i} về thủ tục hành chính` })),
      { role: 'user', content: 'cảm ơn' },
    ]
    const { value: reply, lines } = await captureLogs(() => send(handler, messages))
    assert.notEqual(kindOf(reply), 'moderation_blocked', 'the newest turn is clean and answered')
    const answered = answeredUserTexts()
    assert.ok(!answered.includes(violating), `the violating earlier turn reached the model: ${JSON.stringify(answered)}`)
    assert.equal(state.queue.length, 0, 'an earlier turn never files a row — screened or not')
    // What reaches the model is the newest turn and the earlier turns the budget DID reach — the
    // most recent ones, screened clean — and nothing older.
    assert.ok(answered.length > 1 && answered.length < messages.length, `${answered.length} user turns sent`)
    assert.deepEqual(answered, messages.slice(-answered.length).map(turn => turn.content), 'a contiguous most-recent run')
    assert.equal(lines.filter(line => line.event === 'ai_moderation.request_budget_exhausted').length, 1, 'the cut is logged once')
    reset([])
  })

  test(`${name}: the NEWEST turn is unchanged by that — screened first on the whole budget; rules it never reached do not judge it (fail-open, logged)`, async () => {
    // Pinned so that changing it is a decision, not an accident (docs/decisions/realm-safety.md):
    // refusing every question whose check was cut would let ONE slow rule refuse every visitor.
    // The newest turn has the whole 250 ms; the 30 realistic rules cost ≤ ~38 ms on their worst
    // crafted input together. Here the clock moves 100 ms per reading: the first rule's window
    // ends past the deadline, so the second rule never runs on the newest turn.
    reset([rule('(?:0|\\+84)\\d{9}'), rule('lô\\s*đề')])
    steppingClock(100)
    const { value: reply, lines } = await captureLogs(() => send(handler, [{ role: 'user', content: 'chơi lô đề ở đâu' }]))
    assert.notEqual(kindOf(reply), 'moderation_blocked')
    assert.deepEqual(answeredUserTexts(), ['chơi lô đề ở đâu'])
    assert.equal(state.queue.length, 0)
    assert.equal(lines.filter(line => line.event === 'ai_moderation.request_budget_exhausted').length, 1)
    reset([])
  })
}
