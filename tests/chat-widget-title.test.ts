/**
 * FINDING-C2, the conversation title, RUN on the chat widget harness (tests/_chat-widget-harness.ts):
 * the real `ChatWidget.vue` over the real `useChatbot`, a fake network answering like
 * `server/api/public/chatbot/**`.
 *
 * THE RULE: a conversation's title is the default ("Cuộc trò chuyện mới"), or a question the server
 * ACCEPTED — answered, with a metadata frame whose `kind` says the question was screened and taken
 * (curated / provider / small_talk / not_found / unavailable). Never a question that is waiting,
 * failed (429, no connection, empty stream, 5xx), refused (`moderation_blocked`, 400), answered
 * `rate_limited` (the endpoint charges the rate limit BEFORE moderation: such a question was never
 * screened), cut off before its metadata frame, or cancelled.
 *
 * Each test asserts that rule as an INVARIANT, not as "W is not the title": `watchTitles` collects
 * the questions the server accepted, and every save of the store, the state both surfaces render
 * (the widget's list; /assistant's list and header read the same `conversations` /
 * `activeConversation`), the rendered list, and the list after a reload must hold only those titles.
 * A way in that no test below names still trips it, as long as it saves or shows a title.
 *
 * The ways in found while C2 was open (docs/decisions/refactor-large-files.md, "FINDING-C2"), one
 * test each: refused directly; "Thử lại"; Enter again; the same words sent again; another
 * conversation; a reload while the question waits (F2); a second tab; a reload, then typed again.
 * And three the earlier rounds had not listed: a 200 `rate_limited` answer, a stream cut between the
 * refusal's text and its metadata frame, and a cancel after the first word.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test, { type TestContext } from 'node:test'
import type { Ref } from 'vue'

import { click, fire, input } from './_sfc-mount.ts'
import {
  answer, bubbles, button, buttonsWith, byLabel, chatServer, content, dropped, findAll, HOLD, json, launcher, mainInput, openWidget,
  parsedStorage, QUICK_QUESTIONS, sendForm, sseStream, transcript, words, type ChatCtx, type NetCall,
} from './_chat-widget-harness.ts'
import { CHAT_WIDGET_FAMILY, CHATBOT_COMPOSABLE_FAMILY, familyVueFiles, moduleFamilyFiles, readAppFile } from './_component-family.ts'

const STORE = 'cdkt_sessions_v1'
const DEFAULT_TITLE = 'Cuộc trò chuyện mới'
const W = 'câu vi phạm'
/** A title is the question NFKC-normalised, trimmed, cut to 40 characters. */
const asTitle = (text: string) => text.normalize('NFKC').trim().slice(0, 40)

// ─── What the server answers ─────────────────────────────────────────────────

type Reply = (call: NetCall) => Response | Error
const REFUSAL = 'Nội dung câu hỏi của bạn có dấu hiệu vi phạm chính sách an toàn thông tin.'
const REFUSED: Reply = answer(REFUSAL, { kind: 'moderation_blocked', sources: [] })
/** The endpoint's own rate limit: a normal 200 stream, sent BEFORE the question is screened. */
const SSE_RATE_LIMITED: Reply = answer('Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau.', { kind: 'rate_limited', sources: [], retryAfter: 30 })
const HTTP_429: Reply = () => json({ statusCode: 429, message: 'Bạn gửi quá nhiều yêu cầu. Vui lòng thử lại sau.' }, 429)
const HTTP_502: Reply = () => json({ statusCode: 502, message: 'Bad Gateway' }, 502)
const DROPPED: Reply = () => dropped()
const EMPTY: Reply = (call) => { const s = sseStream(call.signal); s.done(); return s.response }
const INVALID: Reply = () => json({ statusCode: 400, message: 'Invalid chat messages' }, 400)
/** The refusal's text frame arrives; its metadata frame never does (the stream was cut between the two writes). */
const CUT_AFTER_REFUSAL_TEXT: Reply = (call) => { const s = sseStream(call.signal); s.push(content(REFUSAL)); s.end(); return s.response }
const FAILURES = [['429', HTTP_429], ['no connection', DROPPED], ['empty stream', EMPTY], ['502', HTTP_502]] as const

// ─── The invariant ───────────────────────────────────────────────────────────

type ChatState = { conversations: Ref<Array<{ title: string }>>, activeConversation: Ref<{ title: string }> }
const chatState = (ctx: ChatCtx) => (ctx.composable.useChatbot as () => ChatState)()
const lastQuestion = (call: NetCall) =>
  [...(call.body as { messages: Array<{ sender: string, text: string }> }).messages].reverse().find(m => m.sender === 'user')!.text
const historyButton = (ctx: ChatCtx) => byLabel(ctx.widget, 'Danh sách cuộc trò chuyện')
/** The titles the rendered list shows (each row's delete button is labelled "Xóa <title>"). */
const listTitles = (ctx: ChatCtx) => findAll(ctx.widget.root, el => typeof el.props['aria-label'] === 'string'
  && el.props['aria-label'].startsWith('Xóa ') && el.props['aria-label'] !== 'Xóa lịch sử').map(el => String(el.props['aria-label']).slice(4))
const titlesNow = (ctx: ChatCtx) => chatState(ctx).conversations.value.map(c => c.title)

type Watch = ReturnType<typeof watchTitles>

/** The rule on one mount (and on the remounts `assertNeverLeaked` makes from its store). */
function watchTitles(ctx: ChatCtx, alsoAllowed: string[] = []) {
  const allowed = new Set([DEFAULT_TITLE, ...alsoAllowed])
  const violations: string[] = []
  const check = (where: string, titles: string[]) => {
    for (const title of titles) if (!allowed.has(title)) violations.push(`${where}: ${JSON.stringify(title)}`)
  }
  const spyOn = (on: ChatCtx, label: string) => {
    const setItem = on.local.setItem
    on.local.setItem = (key: string, value: string) => {
      if (key === STORE) check(`${label} save`, (JSON.parse(value) as { sessions: Array<{ title: string }> }).sessions.map(s => s.title))
      setItem(key, value)
    }
  }
  spyOn(ctx, 'tab')
  return {
    allowed,
    violations,
    spyOn,
    check,
    /** The question this reply answers is ACCEPTED: its title is allowed from the moment the server takes it. */
    accepting: (reply: Reply = answer('Đã nhận.')): Reply => (call) => { allowed.add(asTitle(lastQuestion(call))); return reply(call) },
    accept: (question: string) => { allowed.add(asTitle(question)) },
    /** State (what the widget list and /assistant render) right now, plus every save so far. */
    assertClean(label: string, on: ChatCtx = ctx) {
      check(`${label} state`, titlesNow(on))
      check(`${label} active`, [chatState(on).activeConversation.value.title])
      assert.deepEqual(violations, [], label)
    },
  }
}

async function openDialog(ctx: ChatCtx) {
  await click(launcher(ctx.widget)!)
  await ctx.settle()
}
async function ask(ctx: ChatCtx, question: string) {
  await input(mainInput(ctx.widget), question)
  await fire(sendForm(ctx.widget), 'submit')
  await ctx.settle()
}
/** Enter again on whatever the input holds (a failure puts the question back there). */
async function enterAgain(ctx: ChatCtx) {
  await fire(sendForm(ctx.widget), 'submit')
  await ctx.settle()
}
async function toggleList(ctx: ChatCtx) {
  await click(historyButton(ctx))
  await ctx.settle()
}
async function newConversation(ctx: ChatCtx) {
  await toggleList(ctx)
  await click(button(ctx.widget, 'Tạo mới'))
  await ctx.settle()
}
const retryIn = (bubble: Parameters<typeof words>[0]) => findAll(bubble, el => el.tag === 'button' && words(el) === 'Thử lại')[0]!
async function startWidget(t: TestContext, local?: Record<string, string>) {
  const ctx = await openWidget(t, chatServer(), local ? { local } : {})
  await openDialog(ctx)
  return ctx
}

/**
 * The end of every test: the rule on the state, the rendered list, every save so far, then a
 * reload from the store (a new page on the same device) and its list. Closes `ctx`; returns the
 * titles the list shows after the reload, for the test's own expectation.
 */
async function assertNeverLeaked(t: TestContext, ctx: ChatCtx, watch: Watch): Promise<string[]> {
  watch.assertClean('end')
  await toggleList(ctx)
  watch.check('list', listTitles(ctx))
  const saved = ctx.local.getItem(STORE)
  ctx.close()
  assert.ok(saved, 'nothing was saved')
  const reloaded = await startWidget(t, { [STORE]: saved })
  watch.spyOn(reloaded, 'reloaded')
  await toggleList(reloaded)
  const after = listTitles(reloaded)
  watch.check('list after reload', after)
  watch.assertClean('after reload', reloaded)
  reloaded.close()
  return after
}

// ─── Refused or never judged: no title ───────────────────────────────────────

test('C2 way 1 — a first question refused by moderation (typed, or a quick question): no title, before or after a reload', async (t) => {
  for (const how of ['typed', 'quick question'] as const) {
    const ctx = await startWidget(t)
    const watch = watchTitles(ctx)
    ctx.server.state.chat.push(REFUSED)
    const question = how === 'typed' ? W : QUICK_QUESTIONS[0]!.question
    if (how === 'typed') await ask(ctx, question)
    else { await click(button(ctx.widget, question)); await ctx.settle() }
    assert.deepEqual(transcript(ctx.widget), [{ who: 'bot', text: REFUSAL }], how)
    assert.deepEqual(await assertNeverLeaked(t, ctx, watch), [DEFAULT_TITLE], how)
  }
})

for (const [failure, fail] of FAILURES) {
  test(`a failed send (${failure}) gives no title; the question waits with "Thử lại", and answered it titles the conversation`, async (t) => {
    const ctx = await startWidget(t)
    const watch = watchTitles(ctx)
    ctx.server.state.chat.push(fail)
    await ask(ctx, 'Hỏi lúc hỏng')
    assert.equal(buttonsWith(ctx.widget, 'Thử lại').length, 1)
    watch.assertClean('after the failure')
    assert.equal(parsedStorage(ctx)!.sessions[0]!.title, DEFAULT_TITLE, 'the failed question is not saved, neither is a title from it')
    ctx.server.state.chat.push(watch.accepting())
    await click(button(ctx.widget, 'Thử lại'))
    await ctx.settle()
    assert.deepEqual(titlesNow(ctx), ['Hỏi lúc hỏng'], 'accepted: now it is the title')
    assert.deepEqual(await assertNeverLeaked(t, ctx, watch), ['Hỏi lúc hỏng'])
  })
}

test('C2 way 2 — "Thử lại" on a failed first question, refused: no title', async (t) => {
  for (const [failure, fail] of [['429', HTTP_429], ['no connection', DROPPED]] as const) {
    for (const [refusal, refuse] of [['moderation', REFUSED], ['400', INVALID]] as const) {
      const ctx = await startWidget(t)
      const watch = watchTitles(ctx)
      ctx.server.state.chat.push(fail, refuse)
      await ask(ctx, W)
      await click(retryIn(bubbles(ctx.widget)[0]!))
      await ctx.settle()
      assert.ok(!transcript(ctx.widget).some(m => m.who === 'user'), `${failure}/${refusal}: the refused question left`)
      assert.deepEqual(await assertNeverLeaked(t, ctx, watch), [DEFAULT_TITLE], `${failure}/${refusal}`)
    }
  }
})

test('C2 way 3 — Enter again on what a failure put back in the input, refused: no title; the failed copy keeps "Thử lại"', async (t) => {
  for (const [refusal, refuse] of [['moderation', REFUSED], ['400', INVALID]] as const) {
    const ctx = await startWidget(t)
    const watch = watchTitles(ctx)
    ctx.server.state.chat.push(HTTP_429, refuse)
    await ask(ctx, W)
    assert.equal(mainInput(ctx.widget).model?.value, W)
    await enterAgain(ctx)
    assert.deepEqual(transcript(ctx.widget).filter(m => m.who === 'user').map(m => m.text), [W], refusal)
    assert.equal(buttonsWith(ctx.widget, 'Thử lại').length, 1, refusal)
    assert.deepEqual(await assertNeverLeaked(t, ctx, watch), [DEFAULT_TITLE], refusal)
  }
})

test('C2 way 4 — refused, then the same words sent again and failing: no title', async (t) => {
  for (const [refusal, refuse] of [['moderation', REFUSED], ['400', INVALID]] as const) {
    for (const [failure, fail] of [['429', HTTP_429], ['no connection', DROPPED]] as const) {
      const ctx = await startWidget(t)
      const watch = watchTitles(ctx)
      ctx.server.state.chat.push(refuse, fail)
      await ask(ctx, W)
      await ask(ctx, W)
      assert.equal(buttonsWith(ctx.widget, 'Thử lại').length, 1, `${refusal}/${failure}: the new copy failed`)
      await newConversation(ctx) // any save
      assert.deepEqual(await assertNeverLeaked(t, ctx, watch), [DEFAULT_TITLE, DEFAULT_TITLE], `${refusal}/${failure}`)
    }
  }
})

test('C2 way 5 — the words asked in one conversation and refused in another: neither conversation takes them', async (t) => {
  const ctx = await startWidget(t)
  const watch = watchTitles(ctx)
  ctx.server.state.chat.push(HTTP_429, REFUSED)
  await ask(ctx, W) // A: failed, waits with "Thử lại"
  await newConversation(ctx)
  await ask(ctx, W) // B: refused
  assert.deepEqual(await assertNeverLeaked(t, ctx, watch), [DEFAULT_TITLE, DEFAULT_TITLE])
})

test('C2 way 6 (F2) — a reload while the question waits for the server: the store holds no title from it', async (t) => {
  const ctx = await startWidget(t)
  const watch = watchTitles(ctx)
  ctx.server.state.chat.push(() => HOLD)
  await ask(ctx, W)
  const midWait = ctx.local.getItem(STORE)
  assert.ok(midWait, 'the session token was saved while the question waits')
  watch.assertClean('while waiting')
  ctx.close()
  const reloaded = await startWidget(t, { [STORE]: midWait! })
  watch.spyOn(reloaded, 'reloaded')
  await toggleList(reloaded)
  assert.deepEqual(listTitles(reloaded), [DEFAULT_TITLE])
  watch.assertClean('after reload', reloaded)
})

test('C2 way 7 — a second tab that loaded the store while the question waited, saving after it was refused', async (t) => {
  const tabA = await startWidget(t)
  const watch = watchTitles(tabA)
  tabA.server.state.chat.push(() => HOLD)
  await ask(tabA, W)
  const loadedByB = tabA.local.getItem(STORE)!
  const held = tabA.server.state.held.shift()!
  held.respond(REFUSED(held) as Response)
  await tabA.settle()
  tabA.close()
  // Tab B holds what it loaded mid-wait, and saves its whole state on its next action.
  const tabB = await startWidget(t, { [STORE]: loadedByB })
  watch.spyOn(tabB, 'tab B')
  await newConversation(tabB)
  watch.assertClean('tab B', tabB)
})

test('C2 way 8 — after a reload, the words typed again and failing: no title', async (t) => {
  const ctx = await startWidget(t)
  const watch = watchTitles(ctx)
  ctx.server.state.chat.push(REFUSED)
  await ask(ctx, W)
  const saved = ctx.local.getItem(STORE)!
  ctx.close()
  const reloaded = await startWidget(t, { [STORE]: saved })
  watch.spyOn(reloaded, 'reloaded')
  reloaded.server.state.chat.push(DROPPED)
  await ask(reloaded, W)
  assert.deepEqual(await assertNeverLeaked(t, reloaded, watch), [DEFAULT_TITLE])
})

test('a 200 "rate_limited" answer (sent before the question is screened) gives no title; the next accepted question does', async (t) => {
  const ctx = await startWidget(t)
  const watch = watchTitles(ctx)
  ctx.server.state.chat.push(SSE_RATE_LIMITED)
  await ask(ctx, W)
  assert.deepEqual(transcript(ctx.widget).map(m => m.text), [W, 'Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau.'])
  watch.assertClean('after rate_limited')
  ctx.server.state.chat.push(watch.accepting())
  await ask(ctx, 'Câu được nhận')
  assert.deepEqual(await assertNeverLeaked(t, ctx, watch), ['Câu được nhận'])
})

test('a stream cut between the refusal\'s text and its metadata frame: no verdict, no title', async (t) => {
  const ctx = await startWidget(t)
  const watch = watchTitles(ctx)
  ctx.server.state.chat.push(CUT_AFTER_REFUSAL_TEXT)
  await ask(ctx, W)
  assert.equal(transcript(ctx.widget).at(-1)?.text, REFUSAL)
  assert.deepEqual(await assertNeverLeaked(t, ctx, watch), [DEFAULT_TITLE])
})

test('a question cancelled before or after its first word (switching away): no title', async (t) => {
  for (const firstWord of [false, true]) {
    const ctx = await startWidget(t)
    const watch = watchTitles(ctx)
    ctx.server.state.chat.push(watch.accepting(answer('Trả lời A.')))
    await ask(ctx, 'Câu A')
    await newConversation(ctx)
    ctx.server.state.chat.push(() => HOLD)
    await ask(ctx, W)
    if (firstWord) {
      const held = ctx.server.state.held.shift()!
      const stream = sseStream(held.signal)
      held.respond(stream.response)
      stream.push(content('Đang trả lời'))
      await ctx.settle()
    }
    await toggleList(ctx)
    await click(button(ctx.widget, 'Câu A'))
    await ctx.settle()
    assert.deepEqual(parsedStorage(ctx)!.sessions[0]!.messages.map(m => m.text), [W], `firstWord=${firstWord}: kept as asked (FINDING-C3)`)
    assert.deepEqual(await assertNeverLeaked(t, ctx, watch), [DEFAULT_TITLE, 'Câu A'], `firstWord=${firstWord}`)
  }
})

// ─── Accepted: the title, once ───────────────────────────────────────────────

test('the server\'s verdict decides: an accepted kind titles the conversation, a refusal, a rate limit or no verdict does not', async (t) => {
  const cases: Array<[string, Record<string, unknown> | null, boolean]> = [
    ['curated', { kind: 'curated', sources: [] }, true],
    ['provider', { kind: 'provider', sources: [] }, true],
    ['small_talk', { kind: 'small_talk', sources: [] }, true],
    ['not_found', { kind: 'not_found', sources: [], askContact: true }, true],
    ['unavailable', { kind: 'unavailable', sources: [] }, true],
    ['moderation_blocked', { kind: 'moderation_blocked', sources: [] }, false],
    ['rate_limited', { kind: 'rate_limited', sources: [], retryAfter: 30 }, false],
    ['an unknown kind', { kind: 'something_else', sources: [] }, false],
    ['no metadata frame', null, false],
  ]
  for (const [label, chatbot, titles] of cases) {
    const ctx = await startWidget(t)
    ctx.server.state.chat.push((call) => {
      const s = sseStream(call.signal)
      s.push(content('Trả lời.'))
      if (chatbot) s.push({ choices: [{ delta: { content: '' } }], chatbot })
      s.done()
      return s.response
    })
    await ask(ctx, `Câu hỏi ${label}`)
    assert.deepEqual(titlesNow(ctx), [titles ? `Câu hỏi ${label}` : DEFAULT_TITLE], label)
    assert.equal(chatState(ctx).activeConversation.value.title, titles ? `Câu hỏi ${label}` : DEFAULT_TITLE, `${label}: what /assistant's header reads`)
    assert.equal(parsedStorage(ctx)!.sessions[0]!.title, titles ? `Câu hỏi ${label}` : DEFAULT_TITLE, `${label}: saved`)
    ctx.close()
  }
})

test('the title is the FIRST accepted question: later answers, a refusal after it, keep it; clearing resets it', async (t) => {
  const ctx = await startWidget(t)
  const watch = watchTitles(ctx)
  ctx.server.state.chat.push(watch.accepting(), watch.accepting(), REFUSED)
  await ask(ctx, 'Câu một')
  assert.deepEqual(titlesNow(ctx), ['Câu một'])
  await ask(ctx, 'Câu hai')
  await ask(ctx, W)
  assert.deepEqual(titlesNow(ctx), ['Câu một'])
  await click(byLabel(ctx.widget, 'Xóa lịch sử'))
  await ctx.settle()
  assert.deepEqual(titlesNow(ctx), [DEFAULT_TITLE])
  assert.equal(parsedStorage(ctx)!.sessions[0]!.title, DEFAULT_TITLE)
  ctx.server.state.chat.push(watch.accepting())
  await ask(ctx, 'Câu ba')
  assert.deepEqual(await assertNeverLeaked(t, ctx, watch), ['Câu ba'])
})

test('a first question refused, then one accepted: the accepted one is the title', async (t) => {
  const ctx = await startWidget(t)
  const watch = watchTitles(ctx)
  ctx.server.state.chat.push(REFUSED, watch.accepting())
  await ask(ctx, W)
  await ask(ctx, 'Câu sạch')
  assert.deepEqual(await assertNeverLeaked(t, ctx, watch), ['Câu sạch'])
})

test('400 "too long", the question shortened and answered: the shortened question is the title', async (t) => {
  const ctx = await startWidget(t)
  const watch = watchTitles(ctx)
  const long = 'Xin hỏi về thủ tục xoá án tích '.repeat(4).trim()
  ctx.server.state.chat.push(
    () => json({ statusCode: 400, message: 'Câu hỏi không được vượt quá 60 ký tự. Vui lòng rút gọn rồi gửi lại.', data: { reason: 'input_too_long', maxChars: 60 } }, 400),
    watch.accepting(),
  )
  await ask(ctx, long)
  assert.deepEqual(titlesNow(ctx), [DEFAULT_TITLE])
  await ask(ctx, long.slice(0, 50))
  assert.deepEqual(await assertNeverLeaked(t, ctx, watch), [asTitle(long.slice(0, 50))])
})

test('"Thử lại" titles the conversation with the question retried, not the draft in the input', async (t) => {
  const ctx = await startWidget(t)
  const watch = watchTitles(ctx)
  ctx.server.state.chat.push(DROPPED, watch.accepting())
  await ask(ctx, 'Câu gốc')
  await input(mainInput(ctx.widget), 'Nháp khác đang soạn')
  await ctx.settle()
  await click(retryIn(bubbles(ctx.widget)[0]!))
  await ctx.settle()
  assert.deepEqual(await assertNeverLeaked(t, ctx, watch), ['Câu gốc'])
})

test('a long question is cut to 40 characters as a title', async (t) => {
  const ctx = await startWidget(t)
  const watch = watchTitles(ctx)
  const question = 'Thủ tục xoá án tích cho người đã chấp hành xong bản án như thế nào?'
  ctx.server.state.chat.push(watch.accepting())
  await ask(ctx, question)
  assert.deepEqual(titlesNow(ctx), [question.slice(0, 40)])
  assert.equal(titlesNow(ctx)[0]!.length, 40)
  await assertNeverLeaked(t, ctx, watch)
})

test('the previous version\'s carried-over conversation keeps its title when a question is accepted in it', async (t) => {
  const legacy = JSON.stringify([{ sender: 'user', text: 'Câu cũ' }, { sender: 'bot', text: 'Trả lời cũ', kind: 'curated' }])
  const ctx = await startWidget(t, { cdkt_chat_history_v2: legacy })
  const watch = watchTitles(ctx, ['Cuộc trò chuyện trước'])
  ctx.server.state.chat.push(watch.accepting())
  await ask(ctx, 'Câu mới')
  assert.deepEqual(titlesNow(ctx), ['Cuộc trò chuyện trước'])
  watch.assertClean('legacy')
})

// ─── One writer ──────────────────────────────────────────────────────────────

test('a conversation title is written in exactly two places: the accepted-question gate (send.ts) and "Xóa lịch sử" (conversations.ts)', () => {
  const files = [
    ...moduleFamilyFiles(CHATBOT_COMPOSABLE_FAMILY),
    ...familyVueFiles(CHAT_WIDGET_FAMILY),
    { file: 'pages/assistant.vue', source: readAppFile('pages/assistant.vue') },
  ]
  const writes = files.flatMap(({ file, source }) =>
    source.split('\n').flatMap((line, i) => (/\.title\s*=(?!=)/.test(line) ? [`${file}:${i + 1}: ${line.trim()}`] : [])))
  assert.deepEqual(writes.map(w => w.split(':')[0]), ['composables/chatbot/conversations.ts', 'composables/chatbot/send.ts'], writes.join('\n'))
  assert.match(writes[0]!, /= CHATBOT_UNTITLED$/, 'clearing resets to the default title')
  const send = readAppFile('composables/chatbot/send.ts')
  assert.match(send, /acceptedQuestionTitle\(/, 'send.ts titles only through acceptedQuestionTitle (app/utils/chatbot-storage.ts)')
  assert.ok(readFileSync(new URL('../app/pages/assistant.vue', import.meta.url), 'utf8').includes('activeConversation.title'),
    '/assistant shows the active conversation\'s title from the shared state')
})
