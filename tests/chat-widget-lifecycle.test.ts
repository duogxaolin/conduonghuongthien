/**
 * The chat widget, RUN — the gaps the wave3 split verifier found in
 * tests/chat-widget-behavior.test.ts, on the same harness (tests/_chat-widget-harness.ts):
 *   - every conversation action cancels the request in flight (switch, delete the open
 *     one, clear) and leaves the input usable;
 *   - the question of a request cancelled before its first word is kept as asked and saved,
 *     as when the cancel comes after the first word (FINDING-C3, fixed after the split);
 *   - the parent hands focus to the question box and the launcher through the parts'
 *     `focus()` (recorded by `recordFocus`, tests/_sfc-mount.ts);
 *   - the send form and the contact form never let the browser submit (`.prevent`);
 *   - unmounting stops the teaser timers, releases the page and removes the window listener;
 *   - a quick-question load replaces (aborts) the one still in flight;
 *   - a question exactly at the character limit is sent.
 * Written after the split and checked green against the pre-split files too
 * (CHAT_WIDGET_FILE / CHATBOT_COMPOSABLE_FILE, see the harness header).
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { click, fire, input } from './_sfc-mount.ts'
import {
  alerts, answer, bubbles, button, byLabel, chatServer, content, findAll, HOLD, isOpen, json, launcher, mainInput, openWidget,
  parsedStorage, QUICK_QUESTIONS, sendForm, sseStream, statuses, transcript, words, type ChatCtx, type NetCall,
} from './_chat-widget-harness.ts'

const chatCalls = (ctx: ChatCtx) => ctx.calls.filter(call => call.method === 'POST' && call.url.pathname === '/api/public/chatbot')
const historyButton = (ctx: ChatCtx) => byLabel(ctx.widget, 'Danh sách cuộc trò chuyện')
const sendButton = (ctx: ChatCtx) => byLabel(ctx.widget, 'Gửi tin nhắn')
const awaiting = (ctx: ChatCtx) => statuses(ctx.widget).filter(text => text.includes('Trợ lý đang soạn câu trả lời'))
const QUESTION_BOX = 'input#public-chatbot-input'
const LAUNCHER = 'button "Hỏi trợ lý AI"'

async function openDialog(ctx: ChatCtx) {
  await click(launcher(ctx.widget)!)
  await ctx.settle()
}

async function ask(ctx: ChatCtx, question: string) {
  await input(mainInput(ctx.widget), question)
  await fire(sendForm(ctx.widget), 'submit')
  await ctx.settle()
}

/** A conversation with an answered question in it, then a second one with a question still waiting. */
async function waitingInSecondConversation(ctx: ChatCtx) {
  ctx.server.state.chat.push(answer('Trả lời A.'))
  await ask(ctx, 'Câu A')
  await click(historyButton(ctx))
  await ctx.settle()
  await click(button(ctx.widget, 'Tạo mới'))
  await ctx.settle()
  ctx.server.state.chat.push(() => HOLD)
  await ask(ctx, 'Câu B')
  assert.equal(awaiting(ctx).length, 1, 'B is waiting for its answer')
  assert.equal(sendButton(ctx).props.disabled, true)
  return chatCalls(ctx).at(-1)!
}

/** The request was cancelled, nothing reads as an error, and the input works again. */
async function assertCancelledAndUsable(ctx: ChatCtx, call: NetCall) {
  assert.equal(call.signal?.aborted, true, 'the request in flight is cancelled')
  assert.equal(awaiting(ctx).length, 0, 'no reply indicator left behind')
  assert.deepEqual(alerts(ctx.widget), [], 'a cancelled request is not an error')
  await input(mainInput(ctx.widget), 'Câu tiếp')
  await ctx.settle()
  assert.equal(mainInput(ctx.widget).props.disabled, false, 'the input is not locked')
  assert.equal(sendButton(ctx).props.disabled, false, 'sending is possible again')
  ctx.server.state.chat.push(answer('Được.'))
  await fire(sendForm(ctx.widget), 'submit')
  await ctx.settle()
  assert.equal(transcript(ctx.widget).at(-1)?.text, 'Được.', 'the next question is answered')
}

// ─── Conversation actions cancel the request in flight ───────────────────────

test('switching to another conversation mid-answer cancels the request and unlocks the input', async (t) => {
  const ctx = await openWidget(t)
  await openDialog(ctx)
  const call = await waitingInSecondConversation(ctx)
  await click(historyButton(ctx))
  await ctx.settle()
  await click(button(ctx.widget, 'Câu A'))
  await ctx.settle()
  assert.deepEqual(transcript(ctx.widget).map(m => m.text), ['Câu A', 'Trả lời A.'])
  await assertCancelledAndUsable(ctx, call)
})

test('deleting the open conversation mid-answer cancels its request', async (t) => {
  const ctx = await openWidget(t)
  await openDialog(ctx)
  const call = await waitingInSecondConversation(ctx)
  await click(historyButton(ctx))
  await ctx.settle()
  await click(byLabel(ctx.widget, 'Xóa Câu B'))
  await ctx.settle()
  assert.deepEqual(transcript(ctx.widget).map(m => m.text), ['Câu A', 'Trả lời A.'], 'lands on the newest survivor')
  await assertCancelledAndUsable(ctx, call)
})

test('deleting ANOTHER conversation mid-answer leaves the request alone', async (t) => {
  const ctx = await openWidget(t)
  await openDialog(ctx)
  const call = await waitingInSecondConversation(ctx)
  await click(historyButton(ctx))
  await ctx.settle()
  await click(byLabel(ctx.widget, 'Xóa Câu A'))
  await ctx.settle()
  assert.equal(call.signal?.aborted, false)
  assert.equal(awaiting(ctx).length, 1)
})

test('clearing the conversation mid-answer cancels its request', async (t) => {
  const ctx = await openWidget(t)
  await openDialog(ctx)
  const call = await waitingInSecondConversation(ctx)
  await click(byLabel(ctx.widget, 'Xóa lịch sử'))
  await ctx.settle()
  assert.deepEqual(transcript(ctx.widget), [])
  await assertCancelledAndUsable(ctx, call)
})

// ─── A question whose request was cancelled (FINDING-C3) ─────────────────────

/** Open the list and pick the conversation titled `title` (or "Tạo mới"). */
async function pickFromList(ctx: ChatCtx, title: string) {
  await click(historyButton(ctx))
  await ctx.settle()
  await click(button(ctx.widget, title))
  await ctx.settle()
}

/** What the visitor sees of conversation B and what is kept for it, once they are back in it. */
function backInB(ctx: ChatCtx) {
  const question = bubbles(ctx.widget)[0]!
  return {
    transcript: transcript(ctx.widget),
    question: words(question),
    questionClass: String(question.props.class),
    alerts: alerts(ctx.widget),
    awaiting: awaiting(ctx).length,
    saved: parsedStorage(ctx)!.sessions.find(s => s.title === 'Câu B')?.messages,
  }
}

test('FINDING-C3 (fixed): leaving before the first word and coming back — the question is kept as asked, not "Đang gửi…", and survives a reload', async (t) => {
  // The bug: a conversation action cancels the request, `submitBotQuestion` then returns
  // early, and the question's "sending" state was only ever cleared by the first word — so
  // the question read "Đang gửi…" for as long as the page lived, and was never saved.
  const ctx = await openWidget(t)
  await openDialog(ctx)
  const call = await waitingInSecondConversation(ctx)
  assert.match(words(bubbles(ctx.widget)[0]!), /Đang gửi…/, 'B is waiting for its first word')
  await pickFromList(ctx, 'Câu A')
  assert.equal(call.signal?.aborted, true)
  assert.deepEqual(parsedStorage(ctx)!.sessions.find(s => s.title === 'Câu B')?.messages.map(m => m.text), ['Câu B'],
    'saved as soon as B is left: a reload from A keeps it')
  await pickFromList(ctx, 'Câu B')
  const back = backInB(ctx)
  assert.deepEqual(back.transcript, [{ who: 'user', text: 'Câu B' }])
  assert.doesNotMatch(back.question, /Đang gửi…/)
  assert.doesNotMatch(back.questionClass, /opacity-60/, 'not dimmed as sending')
  assert.doesNotMatch(back.questionClass, /bg-danger-bg/, 'a cancelled question is not a failed one')
  assert.deepEqual(back.alerts, [])
  assert.equal(back.awaiting, 0)
  assert.deepEqual(back.saved, [{ sender: 'user', text: 'Câu B', sources: [], toolCalls: [], followUps: [] }])

  // A reload brings the conversation back as it was left.
  const saved = ctx.local.getItem('cdkt_sessions_v1')!
  ctx.close()
  const reloaded = await openWidget(t, chatServer(), { local: { cdkt_sessions_v1: saved } })
  await openDialog(reloaded)
  assert.deepEqual(transcript(reloaded.widget), [{ who: 'user', text: 'Câu B' }])
  assert.doesNotMatch(words(bubbles(reloaded.widget)[0]!), /Đang gửi…/)
})

test('FINDING-C3 (fixed): leaving while the chat session is still being opened — the question does not wait on it', async (t) => {
  // The chat request is not sent until a session token comes back, and that request is not
  // cancelled with the chat request. A question left in that window must not read "Đang
  // gửi…" until the session request settles (or forever, if it never does).
  const ctx = await openWidget(t)
  await openDialog(ctx)
  ctx.server.state.chat.push(answer('Trả lời A.'))
  await ask(ctx, 'Câu A')
  await pickFromList(ctx, 'Tạo mới')
  ctx.server.state.session = () => HOLD
  await ask(ctx, 'Câu B')
  const session = ctx.server.state.held.shift()!
  assert.equal(session.url.pathname, '/api/public/chatbot/session', 'B (no token yet) is opening its session')
  assert.match(words(bubbles(ctx.widget)[0]!), /Đang gửi…/)
  await pickFromList(ctx, 'Câu A')
  await pickFromList(ctx, 'Câu B')
  const back = backInB(ctx)
  assert.deepEqual(back.transcript, [{ who: 'user', text: 'Câu B' }])
  assert.equal(back.question, 'Câu B', 'not "Đang gửi…"')
  assert.doesNotMatch(back.questionClass, /opacity-60|bg-danger-bg/)
  assert.deepEqual(back.alerts, [])
  assert.equal(back.awaiting, 0)
  assert.deepEqual(back.saved, [{ sender: 'user', text: 'Câu B', sources: [], toolCalls: [], followUps: [] }])
  // The session answers late: B keeps its token, and the cancelled question is not sent.
  session.respond(json({ ok: true, token: 'tok.late' }))
  await ctx.settle()
  assert.equal(chatCalls(ctx).filter(call => !call.signal?.aborted).length, 1, 'only A\'s question ever went out')
  assert.deepEqual(transcript(ctx.widget), [{ who: 'user', text: 'Câu B' }])
  assert.doesNotMatch(words(bubbles(ctx.widget)[0]!), /Đang gửi…/)
})

test('FINDING-C3 (fixed): a cancelled question unwinding late does not let go of the NEXT question still waiting', async (t) => {
  // B is left while its session request hangs; A2 is then sent and waits; B's session comes
  // back late, so B's send unwinds while A2 is the question awaited. Leaving A2 must still
  // stop it "sending" — the late unwind must not have forgotten which question is awaited.
  const ctx = await openWidget(t)
  await openDialog(ctx)
  ctx.server.state.chat.push(answer('Trả lời A.'))
  await ask(ctx, 'Câu A')
  await pickFromList(ctx, 'Tạo mới')
  ctx.server.state.session = () => HOLD
  await ask(ctx, 'Câu B')
  const session = ctx.server.state.held.shift()!
  await pickFromList(ctx, 'Câu A')
  ctx.server.state.chat.push(() => HOLD)
  await ask(ctx, 'Câu A2')
  assert.equal(awaiting(ctx).length, 1, 'A2 is waiting')
  session.respond(json({ ok: true, token: 'tok.late' }))
  await ctx.settle()
  assert.equal(awaiting(ctx).length, 1, 'A2 is still waiting after B unwound')
  await pickFromList(ctx, 'Câu B')
  await pickFromList(ctx, 'Câu A')
  const a2 = bubbles(ctx.widget).at(-1)!
  assert.equal(words(a2), 'Câu A2', 'not "Đang gửi…"')
  assert.doesNotMatch(String(a2.props.class), /opacity-60/)
  assert.deepEqual(parsedStorage(ctx)!.sessions.find(s => s.title === 'Câu A')?.messages.map(m => m.text), ['Câu A', 'Trả lời A.', 'Câu A2'])
})

test('FINDING-C3 (fixed): cancelled before or after the first word, the conversation ends the same — on screen, saved, and in the next request', async (t) => {
  const ends: unknown[] = []
  for (const firstWordArrived of [false, true]) {
    const ctx = await openWidget(t)
    await openDialog(ctx)
    const call = await waitingInSecondConversation(ctx)
    if (firstWordArrived) {
      const held = ctx.server.state.held.shift()!
      const stream = sseStream(held.signal)
      held.respond(stream.response)
      stream.push(content('Đang trả lời B'))
      await ctx.settle()
      assert.doesNotMatch(words(bubbles(ctx.widget)[0]!), /Đang gửi…/, 'the first word ends "sending"')
    }
    // Leave through "Tạo mới" this time, then come back.
    await pickFromList(ctx, 'Tạo mới')
    assert.equal(call.signal?.aborted, true)
    await pickFromList(ctx, 'Câu B')
    const end = backInB(ctx)
    ctx.server.state.chat.push(answer('Được.'))
    await ask(ctx, 'Câu tiếp')
    ends.push({ ...end, nextRequest: (chatCalls(ctx).at(-1)!.body as { messages: unknown }).messages })
    ctx.close()
  }
  assert.deepEqual(ends[0], ends[1])
  assert.deepEqual((ends[0] as { nextRequest: unknown }).nextRequest, [{ sender: 'user', text: 'Câu B' }, { sender: 'user', text: 'Câu tiếp' }])
})

// ─── Focus handed to the parts' controls ─────────────────────────────────────

test('a new conversation puts focus in the question box', async (t) => {
  const ctx = await openWidget(t)
  await openDialog(ctx)
  await click(historyButton(ctx))
  await ctx.settle()
  const before = ctx.focuses.length
  await click(button(ctx.widget, 'Tạo mới'))
  await ctx.settle()
  assert.deepEqual(ctx.focuses.slice(before), [QUESTION_BOX])
})

test('after an answer, focus goes back to the question box with a mouse, and stays put on a touch screen', async (t) => {
  const desktop = await openWidget(t, chatServer(), { media: { '(hover: hover) and (pointer: fine)': true } })
  await openDialog(desktop)
  desktop.server.state.chat.push(answer('Một.'))
  await ask(desktop, 'Câu một')
  assert.deepEqual(desktop.focuses, [QUESTION_BOX])
  desktop.close()
  const phone = await openWidget(t, chatServer())
  await openDialog(phone)
  phone.server.state.chat.push(answer('Một.'))
  await ask(phone, 'Câu một')
  assert.deepEqual(phone.focuses, [], 'focus() on a phone pops the keyboard back up after every answer')
})

test('closing a dialog that nothing visible opened returns focus to the launcher; a remembered opener gets it instead', async (t) => {
  const ctx = await openWidget(t)
  const exposed = ctx.widget.instance as unknown as { toggleChatbot: () => void }
  exposed.toggleChatbot() // focus was on <body>: there is no opener to go back to
  await ctx.settle()
  ctx.key('Escape')
  await ctx.settle()
  assert.equal(isOpen(ctx.widget), false)
  assert.deepEqual(ctx.focuses, [LAUNCHER])
  ctx.doc.activeElement = ctx.opener
  await openDialog(ctx)
  ctx.key('Escape')
  await ctx.settle()
  assert.deepEqual(ctx.focuses, [LAUNCHER], 'the opener got focus back, not the launcher')
  assert.equal(ctx.events.at(-1), 'focus opener')
})

// ─── Forms never submit the page ─────────────────────────────────────────────

/** A submit event that records whether the page submit was cancelled. */
const submitEvent = (target: unknown) => {
  const event = { type: 'submit', target, currentTarget: target, defaultPrevented: false, preventDefault() { event.defaultPrevented = true }, stopPropagation() {} }
  return event
}

test('the send form and the contact form cancel the browser submit (no navigation, no reload)', async (t) => {
  const ctx = await openWidget(t)
  await openDialog(ctx)
  ctx.server.state.chat.push(answer('Cán bộ sẽ liên hệ.', { kind: 'not_found', sources: [], askContact: true }))
  await input(mainInput(ctx.widget), 'Tôi cần gặp cán bộ')
  const send = submitEvent(sendForm(ctx.widget))
  await fire(sendForm(ctx.widget), 'submit', send)
  await ctx.settle()
  assert.equal(send.defaultPrevented, true, 'the question form')
  assert.equal(chatCalls(ctx).length, 1, 'and it still sent the question')
  const lead = findAll(ctx.widget.root, el => el.tag === 'form' && words(el).includes('Để lại thông tin liên hệ'))[0]!
  const leadSubmit = submitEvent(lead)
  await fire(lead, 'submit', leadSubmit)
  await ctx.settle()
  assert.equal(leadSubmit.defaultPrevented, true, 'the contact form')
  assert.deepEqual(alerts(ctx.widget), ['Vui lòng nhập số điện thoại hoặc email để cán bộ liên hệ.'])
})

// ─── Unmounting cleans up ────────────────────────────────────────────────────

test('unmounting while open releases the page and removes the window listener', async (t) => {
  const ctx = await openWidget(t)
  ctx.doc.activeElement = ctx.opener
  await openDialog(ctx)
  assert.equal(ctx.body.style.overflow, 'hidden')
  assert.equal(ctx.keydownListeners(), 1)
  ctx.close()
  assert.equal(ctx.body.style.overflow, '', 'the page scrolls again')
  assert.equal(ctx.keydownListeners(), 0, 'no window listener outlives the widget')
  assert.equal(ctx.events.at(-1), 'inert removed from div "Hỏi trợ lý AI"', 'the page behind is released')
})

test('unmounting while closed stops the teaser: no timer fires afterwards', async (t) => {
  const ctx = await openWidget(t)
  // After mounting: the SFC compiler's source-map sort uses Math.random too.
  let picks = 0
  t.mock.method(Math, 'random', () => { picks += 1; return 0 })
  await ctx.tick(2_100) // first teaser shown, the 8 s cycle armed
  assert.match(words(ctx.widget), /Bạn cần tìm hiểu về quyền lợi/)
  assert.equal(picks, 1)
  ctx.close()
  t.mock.timers.tick(60_000)
  assert.equal(picks, 1, 'a teaser timer kept running after the widget was gone')
})

// ─── Quick questions: the newest load wins ───────────────────────────────────

test('loading the quick questions again cancels the load still in flight', async (t) => {
  const server = chatServer()
  server.state.quickQuestions = () => HOLD
  const ctx = await openWidget(t, server)
  const first = server.state.held.shift()!
  assert.equal(first.url.pathname, '/api/public/chatbot/quick-questions')
  server.state.quickQuestions = () => json({ ok: true, available: true, items: QUICK_QUESTIONS.slice(0, 1) })
  // The widget and /assistant both load them on mount; the composable is one state.
  await (ctx.composable.useChatbot as () => { loadQuickQuestions: () => Promise<void> })().loadQuickQuestions()
  await ctx.settle()
  assert.equal(first.signal?.aborted, true, 'the older load is cancelled')
  assert.equal(findAll(ctx.widget.root, el => el.tag === 'button' && words(el) === QUICK_QUESTIONS[0]!.question).length, 1)
  assert.equal(findAll(ctx.widget.root, el => el.tag === 'button' && words(el) === QUICK_QUESTIONS[1]!.question).length, 0)
})

// ─── The character limit ─────────────────────────────────────────────────────

test('a question exactly at the character limit is sent; one more character is not', async (t) => {
  const ctx = await openWidget(t)
  await openDialog(ctx)
  ctx.server.state.chat.push(() => HOLD)
  await ask(ctx, 'a'.repeat(2000))
  assert.deepEqual(alerts(ctx.widget), [])
  assert.equal(chatCalls(ctx).length, 1, 'the 2000-character question went out')
  const call = ctx.server.state.held.shift()!
  const stream = sseStream(call.signal)
  call.respond(stream.response)
  stream.push(content('Đã nhận.'))
  stream.done()
  await ctx.settle()
  assert.equal(bubbles(ctx.widget).length, 2)
  await ask(ctx, 'a'.repeat(2001))
  assert.equal(chatCalls(ctx).length, 1, 'the 2001-character one did not')
})
