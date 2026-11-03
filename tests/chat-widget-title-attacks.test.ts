/**
 * Kịch bản tấn công A01–A25 vào FINDING-C2 (tiêu đề chỉ từ câu máy chủ đã nhận), do verifier độc lập
 * của nhánh `wave3/chat-c2` viết; nhập vào repo để ghim kênh `kind` (đột biến V02–V05, V18, W01, W04–W07).
 * Mount: the real ChatWidget.vue + real useChatbot over the fake network of tests/_chat-widget-harness.ts.
 *
 * Oracle (independent of send.ts): a title may be the default, or the question of a reply whose
 * metadata frame the SCENARIO declares accepted (kind in the brief's accepted set, written by a
 * server that took the question). Granted when the frame is actually written, not when the
 * handler is called. On top of that invariant every scenario asserts the exact title per
 * conversation id (right text / wrong conversation; accepted-then-cleared/cancelled).
 */
import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import type { Ref } from 'vue'

import { click, fire, input } from './_sfc-mount.ts'
import {
  bubbles, button, buttonsWith, byLabel, chatServer, content, findAll, HOLD, json, launcher, mainInput, meta, openWidget,
  parsedStorage, QUICK_QUESTIONS, sendForm, sseStream, transcript, words, type ChatCtx, type NetCall,
} from './_chat-widget-harness.ts'

const STORE = 'cdkt_sessions_v1'
const DEFAULT = 'Cuộc trò chuyện mới'
const ACCEPTED_KINDS = new Set(['curated', 'provider', 'small_talk', 'not_found', 'unavailable'])
const W = 'lời lẽ bị cấm'
const REFUSAL = 'Nội dung câu hỏi của bạn có dấu hiệu vi phạm chính sách.'
const asTitle = (text: string) => text.normalize('NFKC').trim().slice(0, 40)

type Frame = Record<string, unknown> | string
type Reply = (call: NetCall) => Response | Error | typeof HOLD
type ChatState = {
  conversations: Ref<Array<{ id: string, title: string, messages: unknown[] }>>
  activeConversation: Ref<{ id: string, title: string }>
}
const chatState = (ctx: ChatCtx) => (ctx.composable.useChatbot as () => ChatState)()
const lastQuestion = (call: NetCall) =>
  [...(call.body as { messages: Array<{ sender: string, text: string }> }).messages].reverse().find(m => m.sender === 'user')!.text
const chatCalls = (ctx: ChatCtx) => ctx.calls.filter(c => c.method === 'POST' && c.url.pathname === '/api/public/chatbot')
const titlesNow = (ctx: ChatCtx) => chatState(ctx).conversations.value.map(c => c.title)
const titlesById = (ctx: ChatCtx) => Object.fromEntries(chatState(ctx).conversations.value.map(c => [c.id, c.title]))
const savedById = (ctx: ChatCtx) => Object.fromEntries((parsedStorage(ctx)?.sessions ?? []).map(s => [s.id, s.title]))
const activeIdOf = (ctx: ChatCtx) => chatState(ctx).activeConversation.value.id
const listTitles = (ctx: ChatCtx) => findAll(ctx.widget.root, el => typeof el.props['aria-label'] === 'string'
  && el.props['aria-label'].startsWith('Xóa ') && el.props['aria-label'] !== 'Xóa lịch sử').map(el => String(el.props['aria-label']).slice(4))
const historyButton = (ctx: ChatCtx) => byLabel(ctx.widget, 'Danh sách cuộc trò chuyện')

function frameText(frame: Frame) { return typeof frame === 'string' ? frame : `data: ${JSON.stringify(frame)}\n\n` }

/** A 200 body that delivers `frames`, then ERRORS like a dropped connection (TypeError), never `[DONE]`. */
function erroringResponse(frames: Frame[], status = 200) {
  const enc = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const f of frames) c.enqueue(enc.encode(frameText(f)))
      setImmediate(() => c.error(new TypeError('network error')))
    },
  })
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } })
}
function rawResponse(text: string, status: number, type = 'text/event-stream') {
  return new Response(text, { status, headers: { 'content-type': type } })
}

function oracle(ctx: ChatCtx, extra: string[] = []) {
  const allowed = new Set([DEFAULT, ...extra])
  const violations: string[] = []
  const check = (where: string, titles: string[]) => {
    for (const title of titles) if (!allowed.has(title)) violations.push(`${where}: ${JSON.stringify(title)}`)
  }
  const spy = (on: ChatCtx, label: string) => {
    const setItem = on.local.setItem
    on.local.setItem = (key: string, value: string) => {
      if (key === STORE) check(`${label} save`, (JSON.parse(value) as { sessions: Array<{ title: string }> }).sessions.map(s => s.title))
      setItem(key, value)
    }
  }
  spy(ctx, 'tab')
  const o = {
    allowed, violations, spy, check,
    grant: (call: NetCall) => { allowed.add(asTitle(lastQuestion(call))) },
    /**
     * A stream of `frames`; `accepted` = the scenario's truth (a real server that took the
     * question). The grant happens when the frame carrying the accepted kind is written.
     */
    reply(frames: Frame[], opts: { end?: 'done' | 'cut' | 'error', accepted?: boolean } = {}): Reply {
      return (call) => {
        if (opts.end === 'error') {
          if (opts.accepted) o.grant(call)
          return erroringResponse(frames)
        }
        const s = sseStream(call.signal)
        for (const f of frames) {
          if (opts.accepted && typeof f === 'object' && typeof (f.chatbot as { kind?: unknown } | undefined)?.kind === 'string'
            && ACCEPTED_KINDS.has((f.chatbot as { kind: string }).kind)) o.grant(call)
          s.push(f)
        }
        if (opts.end === 'cut') s.end()
        else s.done()
        return s.response
      }
    },
    accepted: (text = 'Đã nhận.', chatbot: Record<string, unknown> = { kind: 'curated', sources: [] }) =>
      o.reply([content(text), meta(chatbot)], { accepted: true }),
    refused: () => o.reply([content(REFUSAL), meta({ kind: 'moderation_blocked', sources: [] })]),
    assertClean(label: string, on: ChatCtx = ctx) {
      check(`${label} state`, chatState(on).conversations.value.map(c => c.title))
      check(`${label} active`, [chatState(on).activeConversation.value.title])
      assert.deepEqual(violations, [], label)
    },
  }
  return o
}
type Oracle = ReturnType<typeof oracle>

async function startWidget(t: TestContext, local?: Record<string, string>) {
  const ctx = await openWidget(t, chatServer(), local ? { local } : {})
  await click(launcher(ctx.widget)!)
  await ctx.settle()
  return ctx
}
async function ask(ctx: ChatCtx, question: string) {
  await input(mainInput(ctx.widget), question)
  await fire(sendForm(ctx.widget), 'submit')
  await ctx.settle()
}
async function toggleList(ctx: ChatCtx) { await click(historyButton(ctx)); await ctx.settle() }
async function newConversation(ctx: ChatCtx) {
  await toggleList(ctx)
  await click(button(ctx.widget, 'Tạo mới'))
  await ctx.settle()
}
async function switchTo(ctx: ChatCtx, id: string) {
  await toggleList(ctx)
  const rows = findAll(ctx.widget.root, el => el.tag === 'li'
    && findAll(el, b => b.tag === 'button' && String(b.props['aria-label'] ?? '').startsWith('Xóa ')).length === 1)
  const index = chatState(ctx).conversations.value.findIndex(c => c.id === id)
  await click(findAll(rows[index]!, el => el.tag === 'button')[0]!)
  await ctx.settle()
}
async function clearHistory(ctx: ChatCtx) { await click(byLabel(ctx.widget, 'Xóa lịch sử')); await ctx.settle() }
const retryIn = (bubble: Parameters<typeof words>[0]) => findAll(bubble, el => el.tag === 'button' && words(el) === 'Thử lại')[0]!

/**
 * End: late work runs (clock + settle), the invariant on state / active / every save / the
 * rendered list, then a reload from the store and the same; the exact per-id titles both before
 * and after the reload.
 */
async function finish(t: TestContext, ctx: ChatCtx, o: Oracle, expected: Record<string, string>) {
  await ctx.tick(10_000)
  o.assertClean('end')
  assert.deepEqual(titlesById(ctx), expected, 'state, per id')
  await toggleList(ctx)
  o.check('list', listTitles(ctx))
  const saved = ctx.local.getItem(STORE)
  assert.deepEqual(savedById(ctx), saved ? expected : {}, 'saved, per id')
  ctx.close()
  const reloaded = await startWidget(t, saved ? { [STORE]: saved } : undefined)
  o.spy(reloaded, 'reloaded')
  await toggleList(reloaded)
  o.check('list after reload', listTitles(reloaded))
  o.assertClean('after reload', reloaded)
  if (saved) assert.deepEqual(titlesById(reloaded), expected, 'after reload, per id')
  else assert.deepEqual(Object.values(titlesById(reloaded)), [DEFAULT])
  reloaded.close()
}

// ─── The kind channel (sse.ts) ───────────────────────────────────────────────

test('A01 two metadata frames, provider then moderation_blocked: refused — no title', async (t) => {
  const ctx = await startWidget(t)
  const o = oracle(ctx)
  ctx.server.state.chat.push(o.reply([content(REFUSAL), meta({ kind: 'provider', sources: [] }), meta({ kind: 'moderation_blocked', sources: [] })]))
  await ask(ctx, W)
  assert.ok(!transcript(ctx.widget).some(m => m.who === 'user'))
  await finish(t, ctx, o, { [activeIdOf(ctx)]: DEFAULT })
})

test('A02 toolEvent frames + text, [DONE] without metadata: no verdict — no title; then a refusal still none; then accepted titles', async (t) => {
  const ctx = await startWidget(t)
  const o = oracle(ctx)
  const tool = (status: string) => ({ chatbot: { toolEvent: { name: 'search_c11_knowledge', query: W, status, count: 2 } } })
  ctx.server.state.chat.push(o.reply([tool('calling'), tool('done'), content('Kết quả tra cứu.')]), o.refused(), o.accepted())
  await ask(ctx, W)
  assert.deepEqual(titlesById(ctx), { [activeIdOf(ctx)]: DEFAULT })
  await ask(ctx, 'câu cấm thứ hai')
  await ask(ctx, 'Câu hợp lệ')
  await finish(t, ctx, o, { [activeIdOf(ctx)]: 'Câu hợp lệ' })
})

test('A03 chatbot.replace then the stream is cut before metadata: no title; a refusal next: none', async (t) => {
  const ctx = await startWidget(t)
  const o = oracle(ctx)
  ctx.server.state.chat.push(
    o.reply([content('Hoàng Sa là của '), { choices: [{ delta: { content: '\n\nLập trường.' } }], chatbot: { replace: 'Lập trường chính thức.' } }], { end: 'cut' }),
    o.refused(),
  )
  await ask(ctx, 'Hoàng Sa thuộc nước nào')
  await ask(ctx, W)
  await finish(t, ctx, o, { [activeIdOf(ctx)]: DEFAULT })
})

test('A04 chatbot.replace then metadata curated (the sovereignty path): accepted — the question is the title', async (t) => {
  const ctx = await startWidget(t)
  const o = oracle(ctx)
  ctx.server.state.chat.push(o.reply([
    content('Đoạn đầu '),
    { choices: [{ delta: { content: '\n\nLập trường.' } }], chatbot: { replace: 'Lập trường chính thức.' } },
    meta({ kind: 'curated', sources: [] }),
  ], { accepted: true }))
  await ask(ctx, 'Hoàng Sa thuộc nước nào?')
  await finish(t, ctx, o, { [activeIdOf(ctx)]: 'Hoàng Sa thuộc nước nào?' })
})

test('A05 metadata provider arrives, then the connection drops before [DONE]: a failure — no title; "Thử lại" answered titles', async (t) => {
  const ctx = await startWidget(t)
  const o = oracle(ctx)
  ctx.server.state.chat.push(o.reply([content('Một phần'), meta({ kind: 'provider', sources: [] })], { end: 'error' }))
  await ask(ctx, 'Câu đứt mạng')
  assert.equal(buttonsWith(ctx.widget, 'Thử lại').length, 1, 'a failure, with "Thử lại"')
  assert.deepEqual(titlesById(ctx), { [activeIdOf(ctx)]: DEFAULT })
  assert.equal(parsedStorage(ctx)!.sessions[0]!.title, DEFAULT)
  ctx.server.state.chat.push(o.accepted())
  await click(retryIn(bubbles(ctx.widget)[0]!))
  await ctx.settle()
  await finish(t, ctx, o, { [activeIdOf(ctx)]: 'Câu đứt mạng' })
})

test('A06 malformed / lookalike kinds never title; a kind frame without `choices` does', async (t) => {
  const refusedLike: Array<[string, Frame]> = [
    ['kind null', meta({ kind: null })], ['kind 1', meta({ kind: 1 })], ['kind ""', meta({ kind: '' })],
    ['kind " provider"', meta({ kind: ' provider' })], ['kind "provider "', meta({ kind: 'provider ' })],
    ['kind "PROVIDER"', meta({ kind: 'PROVIDER' })], ['kind ["provider"]', meta({ kind: ['provider'] })],
    ['kind {}', meta({ kind: {} })], ['kind __proto__', meta({ kind: '__proto__' })], ['kind constructor', meta({ kind: 'constructor' })],
    ['kind toString', meta({ kind: 'toString' })], ['kind "moderation_blocked "', meta({ kind: 'moderation_blocked ' })],
    ['chatbot null', { choices: [{ delta: { content: '' } }], chatbot: null }],
    ['chatbot "provider"', { choices: [{ delta: { content: '' } }], chatbot: 'provider' }],
    ['top-level kind', { choices: [{ delta: { content: '' } }], kind: 'provider' }],
    ['kind inside delta', { choices: [{ delta: { content: '', chatbot: { kind: 'provider' } } }] }],
    ['no space after data:', `data:${JSON.stringify(meta({ kind: 'provider' }))}\n\n`],
  ]
  for (const [label, frame] of refusedLike) {
    const ctx = await startWidget(t)
    const o = oracle(ctx)
    ctx.server.state.chat.push(o.reply([content('Trả lời.'), frame]))
    await ask(ctx, `Câu ${label}`)
    assert.deepEqual(titlesById(ctx), { [activeIdOf(ctx)]: DEFAULT }, label)
    o.assertClean(label)
    ctx.close()
  }
  const ctx = await startWidget(t)
  const o = oracle(ctx)
  ctx.server.state.chat.push(o.reply([content('Trả lời.'), { chatbot: { kind: 'small_talk' } }], { accepted: true }))
  await ask(ctx, 'Xin chào')
  await finish(t, ctx, o, { [activeIdOf(ctx)]: 'Xin chào' })
})

test('A07 an accepted kind inside an HTTP error body (500 JSON, 503 SSE, 429 SSE, 400 JSON): never a title', async (t) => {
  const sseAccepted = `data: ${JSON.stringify(content('Trả lời.'))}\n\ndata: ${JSON.stringify(meta({ kind: 'provider' }))}\n\ndata: [DONE]\n\n`
  const cases: Array<[string, () => Response]> = [
    ['500 JSON', () => json({ statusCode: 500, choices: [{ delta: { content: 'x' } }], chatbot: { kind: 'provider' } }, 500)],
    ['503 SSE', () => rawResponse(sseAccepted, 503)],
    ['429 SSE', () => rawResponse(sseAccepted, 429)],
    ['400 JSON', () => json({ statusCode: 400, message: 'Invalid chat messages', data: { kind: 'provider' } }, 400)],
    ['200 JSON, not SSE', () => json({ choices: [{ delta: { content: 'Trả lời.' } }], chatbot: { kind: 'provider' } }, 200)],
  ]
  for (const [label, respond] of cases) {
    const ctx = await startWidget(t)
    const o = oracle(ctx)
    ctx.server.state.chat.push(respond)
    await ask(ctx, `Câu ${label}`)
    await finish(t, ctx, o, { [activeIdOf(ctx)]: DEFAULT })
  }
})

// ─── Lifecycle ───────────────────────────────────────────────────────────────

test('A08 "Xóa lịch sử" while the reply waits, then the server accepts late: no title; refused next: none; accepted: that one', async (t) => {
  for (const firstWord of [false, true]) {
    const ctx = await startWidget(t)
    const o = oracle(ctx)
    ctx.server.state.chat.push(() => HOLD)
    await ask(ctx, 'Câu bị xoá')
    const held = ctx.server.state.held.shift()!
    let stream: ReturnType<typeof sseStream> | null = null
    if (firstWord) {
      stream = sseStream(held.signal)
      held.respond(stream.response)
      stream.push(content('Đang trả lời'))
      await ctx.settle()
    }
    await clearHistory(ctx)
    // The server finishes anyway (it took the question): a late accepted verdict.
    if (stream) { stream.push(meta({ kind: 'provider', sources: [] })); stream.done() }
    else held.respond(o.accepted()(held) as Response)
    await ctx.settle()
    assert.deepEqual(titlesById(ctx), { [activeIdOf(ctx)]: DEFAULT }, `firstWord=${firstWord}: cleared stays untitled`)
    ctx.server.state.chat.push(o.refused(), o.accepted())
    await ask(ctx, W)
    assert.deepEqual(titlesById(ctx), { [activeIdOf(ctx)]: DEFAULT }, `firstWord=${firstWord}`)
    await ask(ctx, 'Câu sau khi xoá')
    // 'Câu bị xoá' was granted by the oracle (the server took it) but must NOT be the title.
    await finish(t, ctx, o, { [activeIdOf(ctx)]: 'Câu sau khi xoá' })
  }
})

test('A09 deleting a NON-active conversation while the active one waits (no cancel): the verdict titles the right conversation', async (t) => {
  for (const accepted of [true, false]) {
    const ctx = await startWidget(t)
    const o = oracle(ctx)
    ctx.server.state.chat.push(o.accepted())
    await ask(ctx, 'Câu X')
    const x = activeIdOf(ctx)
    await newConversation(ctx)
    const y = activeIdOf(ctx)
    ctx.server.state.chat.push(() => HOLD)
    await ask(ctx, 'Câu Y')
    await toggleList(ctx)
    await click(byLabel(ctx.widget, 'Xóa Câu X'))
    await ctx.settle()
    assert.equal(ctx.server.state.held[0]!.signal?.aborted, false, 'deleting another conversation does not cancel')
    const held = ctx.server.state.held.shift()!
    held.respond((accepted ? o.accepted() : o.refused())(held) as Response)
    await ctx.settle()
    assert.ok(!(x in titlesById(ctx)))
    await toggleList(ctx) // the list stays open after a delete
    await finish(t, ctx, o, { [y]: accepted ? 'Câu Y' : DEFAULT })
  }
})

test('A10 a waiting question in the conversation evicted at 10 (Tạo mới): late verdict lands nowhere', async (t) => {
  const NOW = Date.UTC(2026, 9, 29, 3, 0, 0)
  const sessions = Array.from({ length: 10 }, (_, i) => ({
    id: `s${i}`, token: `t${i}.sig`, title: `Seed ${i}`, createdAt: NOW - (10 - i) * 60_000,
    messages: [{ sender: 'user', text: `Seed ${i}` }, { sender: 'bot', text: 'Đã trả lời.', kind: 'curated' }],
  }))
  const ctx = await startWidget(t, { [STORE]: JSON.stringify({ activeId: 's0', sessions }) })
  const o = oracle(ctx, sessions.map(s => s.title))
  assert.equal(activeIdOf(ctx), 's0')
  ctx.server.state.chat.push(() => HOLD)
  await ask(ctx, W)
  await newConversation(ctx)
  const fresh = activeIdOf(ctx)
  const held = ctx.server.state.held.shift()!
  assert.equal(held.signal?.aborted, true)
  held.respond(o.accepted()(held) as Response)
  await ctx.settle()
  const expected: Record<string, string> = { [fresh]: DEFAULT }
  for (let i = 1; i < 10; i++) expected[`s${i}`] = `Seed ${i}`
  // Not granted for the eviction, so a title W anywhere is a violation.
  o.allowed.delete(asTitle(W))
  await finish(t, ctx, o, expected)
})

test('A11 right text, wrong conversation: A waits and is left; B accepted — only B is titled', async (t) => {
  const ctx = await startWidget(t)
  const o = oracle(ctx)
  const a = activeIdOf(ctx)
  ctx.server.state.chat.push(() => HOLD)
  await ask(ctx, 'Câu ở A')
  await newConversation(ctx)
  const b = activeIdOf(ctx)
  const held = ctx.server.state.held.shift()!
  held.respond(o.accepted()(held) as Response) // late, after the cancel
  ctx.server.state.chat.push(o.accepted())
  await ask(ctx, 'Câu ở B')
  await switchTo(ctx, a)
  ctx.server.state.chat.push(o.refused())
  await ask(ctx, W)
  await finish(t, ctx, o, { [b]: 'Câu ở B', [a]: DEFAULT })
})

test('A12 cancelled after the metadata frame but before [DONE] (Tạo mới): no title, whatever the verdict', async (t) => {
  for (const kind of ['moderation_blocked', 'provider']) {
    const ctx = await startWidget(t)
    const o = oracle(ctx)
    const first = activeIdOf(ctx)
    ctx.server.state.chat.push(() => HOLD)
    await ask(ctx, `Câu ${kind}`)
    const held = ctx.server.state.held.shift()!
    const stream = sseStream(held.signal)
    held.respond(stream.response)
    stream.push(content('Trả lời'))
    stream.push(meta({ kind, sources: [] }))
    await ctx.settle()
    await newConversation(ctx)
    stream.done()
    await ctx.settle()
    await finish(t, ctx, o, { [activeIdOf(ctx)]: DEFAULT, [first]: DEFAULT })
  }
})

test('A13 switched away before the first word and back, the same words re-asked and refused: no title', async (t) => {
  const ctx = await startWidget(t)
  const o = oracle(ctx)
  const a = activeIdOf(ctx)
  ctx.server.state.chat.push(() => HOLD)
  await ask(ctx, W)
  await newConversation(ctx)
  const b = activeIdOf(ctx)
  await switchTo(ctx, a)
  ctx.server.state.chat.push(o.refused())
  await ask(ctx, W)
  await finish(t, ctx, o, { [b]: DEFAULT, [a]: DEFAULT })
})

// ─── Entry paths ─────────────────────────────────────────────────────────────

test('A14 follow-up chip: refused gives no title; accepted gives the chip text', async (t) => {
  const ctx = await startWidget(t)
  const o = oracle(ctx)
  ctx.server.state.chat.push(
    o.reply([content('Tạm giới hạn.'), meta({ kind: 'rate_limited', sources: [], followUps: ['Câu gợi ý bị cấm?'] })]),
    o.refused(),
    o.reply([content('Tạm giới hạn.'), meta({ kind: 'rate_limited', sources: [], followUps: ['Gợi ý hợp lệ?'] })]),
    o.accepted(),
  )
  await ask(ctx, 'Câu đầu')
  await click(button(ctx.widget, 'Câu gợi ý bị cấm?'))
  await ctx.settle()
  assert.deepEqual(titlesById(ctx), { [activeIdOf(ctx)]: DEFAULT })
  await ask(ctx, 'Câu thứ hai')
  await click(button(ctx.widget, 'Gợi ý hợp lệ?'))
  await ctx.settle()
  await finish(t, ctx, o, { [activeIdOf(ctx)]: 'Gợi ý hợp lệ?' })
})

test('A15 a quick question while another draft is in the input: refused — none; accepted — the quick question, not the draft', async (t) => {
  const ctx = await startWidget(t)
  const o = oracle(ctx)
  ctx.server.state.chat.push(o.refused(), o.accepted())
  await input(mainInput(ctx.widget), 'Bản nháp riêng tư')
  await click(button(ctx.widget, QUICK_QUESTIONS[0]!.question))
  await ctx.settle()
  assert.deepEqual(titlesById(ctx), { [activeIdOf(ctx)]: DEFAULT })
  await input(mainInput(ctx.widget), 'Bản nháp riêng tư')
  await click(button(ctx.widget, QUICK_QUESTIONS[1]!.question))
  await ctx.settle()
  await finish(t, ctx, o, { [activeIdOf(ctx)]: QUICK_QUESTIONS[1]!.question })
})

test('A16 double submit in one tick: one request; refused — no title', async (t) => {
  const ctx = await startWidget(t)
  const o = oracle(ctx)
  ctx.server.state.chat.push(o.refused())
  await input(mainInput(ctx.widget), W)
  await fire(sendForm(ctx.widget), 'submit')
  await fire(sendForm(ctx.widget), 'submit')
  await ctx.settle()
  assert.equal(chatCalls(ctx).length, 1)
  await finish(t, ctx, o, { [activeIdOf(ctx)]: DEFAULT })
})

test('A17 "Thử lại" a failed question after another was refused, the retry refused too: no title; then accepted', async (t) => {
  const ctx = await startWidget(t)
  const o = oracle(ctx)
  ctx.server.state.chat.push(() => new TypeError('fetch failed'), o.refused(), o.refused(), o.accepted())
  await ask(ctx, 'Câu một')
  await ask(ctx, W)
  await click(retryIn(bubbles(ctx.widget)[0]!))
  await ctx.settle()
  assert.deepEqual(titlesById(ctx), { [activeIdOf(ctx)]: DEFAULT })
  await ask(ctx, 'Câu ba')
  await finish(t, ctx, o, { [activeIdOf(ctx)]: 'Câu ba' })
})

test('A18 rate_limited, refused, cut, then accepted, in one conversation: the accepted one', async (t) => {
  const ctx = await startWidget(t)
  const o = oracle(ctx)
  ctx.server.state.chat.push(
    o.reply([content('Bạn gửi quá nhiều.'), meta({ kind: 'rate_limited', sources: [], retryAfter: 30 })]),
    o.refused(),
    o.reply([content('Nửa câu trả lời')], { end: 'cut' }),
    o.accepted(),
  )
  await ask(ctx, 'Câu rate')
  await ask(ctx, W)
  await ask(ctx, 'Câu cắt')
  await ask(ctx, 'Câu nhận')
  await finish(t, ctx, o, { [activeIdOf(ctx)]: 'Câu nhận' })
})

test('A19 the session endpoint fails (no token), refused: no title; 413 rejected, then shortened and accepted', async (t) => {
  const ctx = await startWidget(t)
  const o = oracle(ctx)
  ctx.server.state.session = () => json({ statusCode: 500 }, 500)
  ctx.server.state.chat.push(o.refused(), () => json({ statusCode: 413, message: 'Request is too large' }, 413), o.accepted())
  await ask(ctx, W)
  assert.equal(chatCalls(ctx)[0]!.headers['x-chat-session'], undefined)
  await ask(ctx, 'Câu quá lớn')
  assert.equal(mainInput(ctx.widget).model?.value, 'Câu quá lớn', 'the draft is back')
  assert.deepEqual(titlesById(ctx), { [activeIdOf(ctx)]: DEFAULT })
  await ask(ctx, 'Câu nhỏ')
  await finish(t, ctx, o, { [activeIdOf(ctx)]: 'Câu nhỏ' })
})

// ─── Text of the question ────────────────────────────────────────────────────

test('A20 whitespace / zero-width questions: blank not sent; zero-width refused — none', async (t) => {
  const ctx = await startWidget(t)
  const o = oracle(ctx)
  await ask(ctx, '   \n\t ')
  assert.equal(chatCalls(ctx).length, 0)
  ctx.server.state.chat.push(o.refused(), o.refused())
  await ask(ctx, '​')
  await ask(ctx, `​${W}‍`)
  await finish(t, ctx, o, { [activeIdOf(ctx)]: DEFAULT })
})

test('A21 HTML / mustache in the question: refused — none; accepted — shown as text in the list, never as markup', async (t) => {
  const ctx = await startWidget(t)
  const o = oracle(ctx)
  ctx.server.state.chat.push(o.refused(), o.accepted())
  await ask(ctx, '<script>alert(1)</script>')
  await ask(ctx, '{{ 7*7 }} <img src=x onerror=alert(1)>')
  const id = activeIdOf(ctx)
  await toggleList(ctx)
  const list = words(ctx.widget)
  assert.match(list, /\{\{ 7\*7 \}\} <img src=x onerror=alert\(1\)>/)
  assert.equal(findAll(ctx.widget.root, el => el.tag === 'img' || el.tag === 'script').length, 0)
  await toggleList(ctx)
  await finish(t, ctx, o, { [id]: asTitle('{{ 7*7 }} <img src=x onerror=alert(1)>') })
})

test('A22 a 2000-character question: refused — none; accepted — 40 characters', async (t) => {
  const ctx = await startWidget(t)
  const o = oracle(ctx)
  const long = 'Thủ tục '.repeat(250).trim()
  ctx.server.state.chat.push(o.refused(), o.accepted())
  await ask(ctx, long.slice(0, 2000))
  await ask(ctx, long.slice(0, 1999))
  assert.equal(titlesNow(ctx)[0]!.length, 40)
  // The cut keeps a trailing space here ("...Thủ tục ") which a reload trims (normalizeConversation):
  // cosmetic, base does the same — allow the trimmed form, record it.
  const inMemory = titlesNow(ctx)[0]!
  o.allowed.add(inMemory.trim())
  t.diagnostic(`title in memory ${JSON.stringify(inMemory)} (len ${inMemory.length})`)
  const id = activeIdOf(ctx)
  await ctx.tick(10_000)
  o.assertClean('end')
  const saved = ctx.local.getItem(STORE)!
  ctx.close()
  const reloaded = await startWidget(t, { [STORE]: saved })
  o.spy(reloaded, 'reloaded')
  t.diagnostic(`title after reload ${JSON.stringify(titlesById(reloaded)[id])}`)
  o.assertClean('after reload', reloaded)
  reloaded.close()
})

// ─── Hydrate ─────────────────────────────────────────────────────────────────

test('A23 hydrate: empty / non-string / blank / padded default titles read as untitled — a refusal leaves them, an accepted question titles them', async (t) => {
  const NOW = Date.UTC(2026, 9, 29, 3, 0, 0)
  const sessions = [
    { id: 'c1', token: null, title: '', createdAt: NOW - 1000, messages: [] },
    { id: 'c2', token: null, title: 42, createdAt: NOW - 2000, messages: [] },
    { id: 'c3', token: null, title: '   ', createdAt: NOW - 3000, messages: [] },
    { id: 'c4', token: null, title: `  ${DEFAULT}  `, createdAt: NOW - 4000, messages: [] },
  ]
  const ctx = await startWidget(t, { [STORE]: JSON.stringify({ activeId: 'c1', sessions }) })
  const o = oracle(ctx)
  assert.deepEqual(titlesById(ctx), { c1: DEFAULT, c2: DEFAULT, c3: DEFAULT, c4: DEFAULT })
  ctx.server.state.chat.push(o.refused(), o.accepted())
  await ask(ctx, W)
  assert.equal(titlesById(ctx).c1, DEFAULT)
  await ask(ctx, 'Câu c1')
  await switchTo(ctx, 'c4')
  ctx.server.state.chat.push(o.refused(), o.accepted())
  await ask(ctx, W)
  await ask(ctx, 'Câu c4')
  await finish(t, ctx, o, { c1: 'Câu c1', c2: DEFAULT, c3: DEFAULT, c4: 'Câu c4' })
})

test('A24 KNOWN (out of scope): a title saved by an older build is restored as-is and an accepted question does not replace it', async (t) => {
  const NOW = Date.UTC(2026, 9, 29, 3, 0, 0)
  const sessions = [{ id: 'old', token: 'x.sig', title: 'câu bị chặn ở bản cũ', createdAt: NOW - 1000, messages: [] }]
  const ctx = await startWidget(t, { [STORE]: JSON.stringify({ activeId: 'old', sessions }) })
  const o = oracle(ctx, ['câu bị chặn ở bản cũ'])
  ctx.server.state.chat.push(o.accepted())
  await ask(ctx, 'Câu mới được nhận')
  await finish(t, ctx, o, { old: 'câu bị chặn ở bản cũ' })
})

test('A25 an accepted question that reads exactly like the default: the conversation stays "untitled"; a refusal next — none; the next accepted titles it', async (t) => {
  const ctx = await startWidget(t)
  const o = oracle(ctx)
  ctx.server.state.chat.push(o.accepted(), o.refused(), o.accepted())
  await ask(ctx, DEFAULT)
  await ask(ctx, W)
  assert.deepEqual(titlesNow(ctx), [DEFAULT])
  await ask(ctx, 'Câu thật')
  await finish(t, ctx, o, { [activeIdOf(ctx)]: 'Câu thật' })
})
