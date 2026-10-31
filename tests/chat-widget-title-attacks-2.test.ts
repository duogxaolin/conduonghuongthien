/**
 * Kịch bản tấn công vòng 2 (A26–A32) vào FINDING-C2, do verifier độc lập của nhánh `wave3/chat-c2` viết:
 * lấp chỗ hở của tests/chat-widget-title-attacks.test.ts (A01–A25) và của
 * tests/chat-widget-title.test.ts: two tabs acting on the SAME conversation id, a lone `done`
 * toolEvent (kills mutant V05), `chatbot.replace` AFTER metadata, frames after `[DONE]`, a race
 * between two consecutive questions during playback, metadata split across network chunks, CRLF.
 *
 * Same oracle as round 1 (independent of send.ts): a title may be the default, or the question of
 * a reply whose metadata frame the SCENARIO declares accepted. Checked on every `setItem` of the
 * store, the state, the active conversation, the rendered list, and after a reload.
 */
import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import type { Ref } from 'vue'

import { click, fire, input } from './_sfc-mount.ts'
import {
  button, byLabel, chatServer, content, findAll, HOLD, launcher, mainInput, meta, openWidget,
  parsedStorage, sendForm, sseStream, transcript, type ChatCtx, type NetCall,
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
const titlesNow = (ctx: ChatCtx) => chatState(ctx).conversations.value.map(c => c.title)
const titlesById = (ctx: ChatCtx) => Object.fromEntries(chatState(ctx).conversations.value.map(c => [c.id, c.title]))
const savedById = (ctx: ChatCtx) => Object.fromEntries((parsedStorage(ctx)?.sessions ?? []).map(s => [s.id, s.title]))
const activeIdOf = (ctx: ChatCtx) => chatState(ctx).activeConversation.value.id
const listTitles = (ctx: ChatCtx) => findAll(ctx.widget.root, el => typeof el.props['aria-label'] === 'string'
  && el.props['aria-label'].startsWith('Xóa ') && el.props['aria-label'] !== 'Xóa lịch sử').map(el => String(el.props['aria-label']).slice(4))
const historyButton = (ctx: ChatCtx) => byLabel(ctx.widget, 'Danh sách cuộc trò chuyện')

const frameText = (frame: Frame) => (typeof frame === 'string' ? frame : `data: ${JSON.stringify(frame)}\n\n`)
/** A 200 SSE body delivered as exactly these network chunks (each `read()` returns one), then closed. */
function chunked(chunks: string[]) {
  const enc = new TextEncoder()
  let i = 0
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (i < chunks.length) c.enqueue(enc.encode(chunks[i++]!))
      else c.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
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
    reply(frames: Frame[], opts: { accepted?: boolean } = {}): Reply {
      return (call) => {
        const s = sseStream(call.signal)
        for (const f of frames) {
          if (opts.accepted && typeof f === 'object' && typeof (f.chatbot as { kind?: unknown } | undefined)?.kind === 'string'
            && ACCEPTED_KINDS.has((f.chatbot as { kind: string }).kind)) o.grant(call)
          s.push(f)
        }
        s.done()
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

async function startWidget(t: TestContext, local?: Record<string, string>, media?: Record<string, boolean>) {
  const ctx = await openWidget(t, chatServer(), { ...(local ? { local } : {}), ...(media ? { media } : {}) })
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

/** Late work runs; invariant on state / active / every save / rendered list; reload and the same; exact per-id titles. */
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

// ─── Two tabs, the same conversation id ──────────────────────────────────────

test('A26 two tabs, one conversation id: B loads the store while A waits on W; B asks Z (refused) then Y (accepted); A is refused late, then answered — every save of both tabs, and the last writer, carry no refused words', async (t) => {
  // The widget has no `storage` listener: each tab saves its whole in-memory state (last writer
  // wins) and never re-reads the store after hydrate. So a tab's saves depend only on itself and
  // what it loaded — running the tabs one after the other from the mid-wait snapshot is exact.
  const tabA = await startWidget(t)
  const o = oracle(tabA)
  const id = activeIdOf(tabA)
  tabA.server.state.chat.push(() => HOLD)
  await ask(tabA, W)
  const midWait = tabA.local.getItem(STORE)!
  assert.equal(JSON.parse(midWait).sessions[0].title, DEFAULT, 'the store mid-wait: untitled')
  const held = tabA.server.state.held.shift()!
  held.respond(o.refused()(held) as Response)
  await tabA.settle()
  tabA.server.state.chat.push(o.accepted())
  await ask(tabA, 'Câu của tab A')
  await tabA.tick(10_000)
  o.assertClean('tab A')
  const savedByA = tabA.local.getItem(STORE)!
  tabA.close()

  const tabB = await startWidget(t, { [STORE]: midWait })
  o.spy(tabB, 'tab B')
  assert.equal(activeIdOf(tabB), id, 'B opens the same conversation')
  tabB.server.state.chat.push(o.refused(), o.accepted())
  await ask(tabB, 'câu cấm của tab B')
  assert.deepEqual(titlesById(tabB), { [id]: DEFAULT })
  await ask(tabB, 'Câu của tab B')
  // B wrote last: its own accepted question, never A's or B's refused words.
  await finish(t, tabB, o, { [id]: 'Câu của tab B' })
  // And had A written last, its store is just as clean.
  assert.deepEqual(Object.fromEntries((JSON.parse(savedByA).sessions as Array<{ id: string, title: string }>).map(s => [s.id, s.title])),
    { [id]: 'Câu của tab A' })
})

// ─── The kind channel ────────────────────────────────────────────────────────

test('A27 a lone `done` toolEvent (no `calling` before it) + text, [DONE] without metadata: no verdict — no title; then a refusal: none; then accepted', async (t) => {
  const ctx = await startWidget(t)
  const o = oracle(ctx)
  const done = { chatbot: { toolEvent: { name: 'search_c11_articles', query: W, status: 'done', count: 3 } } }
  ctx.server.state.chat.push(o.reply([done, content('Có ba bài.')]), o.refused(), o.accepted())
  await ask(ctx, W)
  assert.deepEqual(titlesNow(ctx), [DEFAULT], 'a tool that ran is no verdict')
  await ask(ctx, 'câu cấm hai')
  await ask(ctx, 'Câu được nhận')
  await finish(t, ctx, o, { [activeIdOf(ctx)]: 'Câu được nhận' })
})

test('A28 `chatbot.replace` AFTER the metadata frame: the verdict stands — refused stays refused, accepted titles', async (t) => {
  const replace = { choices: [{ delta: { content: '\n\nLập trường.' } }], chatbot: { replace: 'Lập trường chính thức.' } }
  {
    const ctx = await startWidget(t)
    const o = oracle(ctx)
    ctx.server.state.chat.push(o.reply([content(REFUSAL), meta({ kind: 'moderation_blocked', sources: [] }), replace]))
    await ask(ctx, W)
    assert.ok(!transcript(ctx.widget).some(m => m.who === 'user'), 'still treated as refused: the question leaves')
    await finish(t, ctx, o, { [activeIdOf(ctx)]: DEFAULT })
  }
  {
    const ctx = await startWidget(t)
    const o = oracle(ctx)
    ctx.server.state.chat.push(o.reply([content('Trả lời '), meta({ kind: 'provider', sources: [] }), replace], { accepted: true }))
    await ask(ctx, 'Hoàng Sa thuộc nước nào?')
    await finish(t, ctx, o, { [activeIdOf(ctx)]: 'Hoàng Sa thuộc nước nào?' })
  }
})

test('A29 frames after `[DONE]` in the same network chunk (newline-terminated) are not read: a late accepted kind does not title a refused question', async (t) => {
  const ctx = await startWidget(t)
  const o = oracle(ctx)
  ctx.server.state.chat.push(() => chunked([
    frameText(content(REFUSAL)) + frameText(meta({ kind: 'moderation_blocked', sources: [] })) + 'data: [DONE]\n\n'
    + frameText(meta({ kind: 'provider', sources: [] })),
  ]))
  await ask(ctx, W)
  await finish(t, ctx, o, { [activeIdOf(ctx)]: DEFAULT })
})

test('A30 race: two consecutive questions during playback (motion on) — refused then accepted: the accepted one; accepted then refused: the first', async (t) => {
  const motion = { '(prefers-reduced-motion: reduce)': false }
  {
    const ctx = await startWidget(t, undefined, motion)
    const o = oracle(ctx)
    ctx.server.state.chat.push(o.refused(), o.accepted('Một câu trả lời khá dài để màn gõ chữ còn đang chạy khi câu sau được gửi.'))
    await ask(ctx, W)
    // The refusal is still being typed out (mocked clock not moved): send the next one now.
    await ask(ctx, 'Câu B được nhận')
    await finish(t, ctx, o, { [activeIdOf(ctx)]: 'Câu B được nhận' })
  }
  {
    const ctx = await startWidget(t, undefined, motion)
    const o = oracle(ctx)
    ctx.server.state.chat.push(o.accepted('Một câu trả lời khá dài để màn gõ chữ còn đang chạy khi câu sau được gửi.'), o.refused())
    await ask(ctx, 'Câu A được nhận')
    await ask(ctx, W)
    await finish(t, ctx, o, { [activeIdOf(ctx)]: 'Câu A được nhận' })
  }
})

test('A31 a metadata frame split across network chunks: a refusal split anywhere gives no title; an accepted kind split anywhere titles', async (t) => {
  const blocked = frameText(meta({ kind: 'moderation_blocked', sources: [] }))
  const curated = frameText(meta({ kind: 'curated', sources: [] }))
  for (const cut of [3, 10, 25, blocked.length - 3, blocked.length - 1]) {
    const ctx = await startWidget(t)
    const o = oracle(ctx)
    ctx.server.state.chat.push(() => chunked([frameText(content(REFUSAL)), blocked.slice(0, cut), blocked.slice(cut), 'data: [DONE]\n\n']))
    await ask(ctx, `${W} ${cut}`)
    assert.deepEqual(titlesNow(ctx), [DEFAULT], `refusal cut at ${cut}`)
    o.assertClean(`refusal cut at ${cut}`)
    ctx.close()
  }
  for (const cut of [3, 25, curated.length - 1]) {
    const ctx = await startWidget(t)
    const o = oracle(ctx)
    ctx.server.state.chat.push((call: NetCall) => {
      o.grant(call)
      return chunked([frameText(content('Đã nhận.')), curated.slice(0, cut), curated.slice(cut), 'data: [DONE]\n\n'])
    })
    await ask(ctx, `Câu tách ${cut}`)
    await finish(t, ctx, o, { [activeIdOf(ctx)]: `Câu tách ${cut}` })
  }
})

test('A32 CRLF line endings: refusal — no title; accepted — titles', async (t) => {
  const crlf = (frames: Frame[]) => frames.map(f => frameText(f).replace(/\n/g, '\r\n')).join('') + 'data: [DONE]\r\n\r\n'
  {
    const ctx = await startWidget(t)
    const o = oracle(ctx)
    ctx.server.state.chat.push(() => chunked([crlf([content(REFUSAL), meta({ kind: 'moderation_blocked', sources: [] })])]))
    await ask(ctx, W)
    await finish(t, ctx, o, { [activeIdOf(ctx)]: DEFAULT })
  }
  {
    const ctx = await startWidget(t)
    const o = oracle(ctx)
    ctx.server.state.chat.push((call: NetCall) => { o.grant(call); return chunked([crlf([content('Đã nhận.'), meta({ kind: 'not_found', sources: [] })])]) })
    await ask(ctx, 'Câu CRLF')
    await finish(t, ctx, o, { [activeIdOf(ctx)]: 'Câu CRLF' })
  }
})

// ─── Observation, not the C2 invariant (pre-existing framing, base identical) ─

test('OBS-1 a line after `[DONE]` with NO trailing newline is still parsed (the post-loop buffer tail): report what it does', async (t) => {
  // The real server never writes after `[DONE]` (index.post.ts ends the response). Recorded, not asserted as a leak.
  const ctx = await startWidget(t)
  ctx.server.state.chat.push(() => chunked([
    frameText(content(REFUSAL)) + frameText(meta({ kind: 'moderation_blocked', sources: [] })) + 'data: [DONE]\n\n'
    + `data: ${JSON.stringify(meta({ kind: 'provider', sources: [] }))}`,
  ]))
  await ask(ctx, W)
  await ctx.tick(10_000)
  t.diagnostic(`OBS-1 title=${JSON.stringify(titlesNow(ctx))} saved=${JSON.stringify(savedById(ctx))} transcript=${JSON.stringify(transcript(ctx.widget).map(m => m.who))}`)
  void button
})
