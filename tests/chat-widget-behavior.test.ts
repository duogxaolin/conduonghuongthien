/**
 * The public chat widget, RUN: the real `ChatWidget.vue` (and whatever it is made of) with
 * the real `useChatbot` behind it, mounted on the mini DOM of tests/_chat-widget-harness.ts
 * over a fake network that answers like `server/api/public/chatbot/**`.
 *
 * Written BEFORE the wave3 split of `ChatWidget.vue` (620 lines) and `useChatbot.ts`
 * (857 lines), green on that tree, and kept unchanged across the split: every test here is
 * about what a visitor sees and what goes over the wire, never about which file holds a
 * line. The sibling suites (`chatbot-public-widget`, `chat-widget-dialog-a11y`, …) pin
 * source text; this one proves the behaviour survived.
 *
 * Run it against another version of the widget (the pre-split tree) with
 * CHAT_WIDGET_FILE / CHATBOT_COMPOSABLE_FILE, and record the DOM after every step with
 * CHAT_WIDGET_DOM_LOG (see the harness header).
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { isReadonly, isRef } from 'vue'

import { click, fire, input, isShown } from './_sfc-mount.ts'
import {
  alerts, answer, bubbles, button, buttonsWith, byId, byLabel, byTag, chatServer, content, dialogOf, dropped, findAll, HOLD,
  isOpen, json, launcher, mainInput, meta, mountChat, openWidget, parsedStorage, QUICK_QUESTIONS, sendForm, sseStream,
  statuses, transcript, words, type ChatCtx, type NetCall, type SseStream,
} from './_chat-widget-harness.ts'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const chatCalls = (ctx: ChatCtx) => ctx.calls.filter(call => call.method === 'POST' && call.url.pathname === '/api/public/chatbot')
type ChatBody = { messages: Array<{ sender: string, text: string }>, _h: string }
const lastChatBody = (ctx: ChatCtx) => chatCalls(ctx).at(-1)?.body as ChatBody

async function openDialog(ctx: ChatCtx) {
  await click(launcher(ctx.widget)!)
  await ctx.settle()
  assert.equal(isOpen(ctx.widget), true, 'the dialog did not open')
}

/** Type a question and submit the form, as a visitor pressing Enter. */
async function ask(ctx: ChatCtx, question: string) {
  await input(mainInput(ctx.widget), question)
  await fire(sendForm(ctx.widget), 'submit')
  await ctx.settle()
}

/** Hold the next chat request; `release()` answers it with a stream the test writes into. */
function holdChat(ctx: ChatCtx): { release: () => SseStream } {
  ctx.server.state.chat.push(() => HOLD)
  return {
    release() {
      const call = ctx.server.state.held.shift()
      assert.ok(call, 'the widget did not send the chat request')
      const stream = sseStream(call.signal)
      call.respond(stream.response)
      return stream
    },
  }
}

const SAVED = (sessions: unknown[], activeId: string) => ({ cdkt_sessions_v1: JSON.stringify({ activeId, sessions }) })
const SOURCE_7 = { id: 7, question: 'Thủ tục xoá án tích?', answer: 'Theo Điều 70 Bộ luật Hình sự…', source: { label: 'Tài liệu Hỏi – Đáp', reference: 'STT 7', url: null } }
const awaiting = (ctx: ChatCtx) => statuses(ctx.widget).filter(text => text.includes('Trợ lý đang soạn câu trả lời'))
const sendButton = (ctx: ChatCtx) => byLabel(ctx.widget, 'Gửi tin nhắn')
const historyButton = (ctx: ChatCtx) => byLabel(ctx.widget, 'Danh sách cuộc trò chuyện')

// ─── Surface ─────────────────────────────────────────────────────────────────

test('useChatbot keeps its public surface: export names and the shape of what useChatbot() returns', async (t) => {
  const ctx = await mountChat(t)
  const names = Object.keys(ctx.composable).sort()
  assert.deepEqual(names, [
    'CHATBOT_CLIENT_LIMITS', 'CHATBOT_RESPONSE_KINDS', 'CHATBOT_SEND_FAILURE_MESSAGES', 'CHATBOT_WELCOME_MESSAGE',
    'chatInputTooLongText', 'describeChatSendFailure', 'isProblemKind', 'isSourceExpanded', 'knowledgeEntryId',
    'messageKindClass', 'messageKindLabel', 'normalizeConversation', 'normalizeFollowUps', 'normalizeSource',
    'normalizeStoredMessage', 'parseSseLine', 'safeHttpsUrl', 'safeSourceUrl', 'sourceDetailOf', 'useChatbot',
  ])
  const api = (ctx.composable.useChatbot as () => Record<string, unknown>)()
  const kinds = Object.entries(api).map(([key, value]) => `${key}:${isRef(value) ? (isReadonly(value) ? 'computed' : 'ref') : typeof value}`)
  assert.deepEqual(kinds, [
    'conversations:ref', 'activeId:ref', 'activeConversation:computed', 'chatMessages:computed', 'isSubmitting:ref',
    'isAwaitingFirstWord:computed', 'botInput:ref', 'botInputError:ref', 'quickQuestions:ref', 'quickQuestionState:ref',
    'quickQuestionStatusText:computed', 'hydrate:function', 'persist:function', 'loadQuickQuestions:function',
    'createConversation:function', 'switchConversation:function', 'deleteConversation:function', 'clearChatHistory:function',
    'submitBotQuestion:function', 'submitLead:function', 'stopTypewriter:function', 'sourceDetails:ref', 'expandedSourceIds:ref',
    'sourceDetailOf:function', 'isSourceExpanded:function', 'toggleSourceDetail:function', 'retrySourceDetail:function',
    'limits:computed', 'isProblemKind:function', 'messageKindLabel:function', 'messageKindClass:function',
  ])
  // Two calls are one state: the widget and /assistant show the same conversation.
  const again = (ctx.composable.useChatbot as () => Record<string, unknown>)()
  for (const key of ['conversations', 'activeId', 'isSubmitting', 'botInput', 'limits']) assert.equal(again[key], api[key], key)
  // The layout drives the widget through exactly this (bottom-nav button, design D24).
  const exposed = ctx.widget.instance as unknown as Record<string, unknown>
  for (const name of ['openChatbot', 'closeChatbot', 'toggleChatbot']) assert.equal(typeof exposed[name], 'function', name)
  assert.equal(exposed.isChatbotOpen, false)
})

// ─── First paint ─────────────────────────────────────────────────────────────

test('mounts closed: launcher shown, approved quick questions loaded, a fresh conversation, nothing sent', async (t) => {
  const ctx = await openWidget(t)
  assert.equal(isOpen(ctx.widget), false)
  assert.equal(dialogOf(ctx.widget)!.props['aria-hidden'], true)
  assert.equal(dialogOf(ctx.widget)!.props.inert, true)
  assert.ok(launcher(ctx.widget), 'the launcher is rendered')
  assert.equal(launcher(ctx.widget)!.props['aria-expanded'], false)
  assert.deepEqual(ctx.calls.map(call => `${call.method} ${call.url.pathname}`), ['GET /api/public/chatbot/quick-questions'])
  for (const q of QUICK_QUESTIONS) assert.equal(buttonsWith(ctx.widget, q.question).length, 1, q.question)
  assert.match(words(ctx.widget), /Xin chào! Tôi hỗ trợ tra cứu thông tin/)
  assert.deepEqual(transcript(ctx.widget), [])
  assert.equal(ctx.local.getItem('cdkt_sessions_v1'), null, 'a blank first visit writes nothing')
  assert.equal(ctx.body.style.overflow, '', 'closed: the page behind still scrolls')
})

// ─── Open / close, focus, inert (design D24) ─────────────────────────────────

test('opening moves focus inside, makes the page behind inert and stops it scrolling; Escape undoes it in order', async (t) => {
  const ctx = await openWidget(t)
  ctx.doc.activeElement = ctx.opener
  await openDialog(ctx)
  assert.equal(dialogOf(ctx.widget)!.props['aria-hidden'], false)
  assert.equal(dialogOf(ctx.widget)!.props.inert, false)
  assert.equal(launcher(ctx.widget)!.props['aria-expanded'], true)
  assert.equal(ctx.body.style.overflow, 'hidden')
  assert.equal(ctx.keydownListeners(), 1, 'Escape/Tab are heard at window level while open')
  // The first control actually shown (the phone back button), not the desktop close button.
  assert.deepEqual(ctx.events, ['inert set on div "Hỏi trợ lý AI"', 'focus button [Quay lại]'])
  const launcherBox = launcher(ctx.widget)!.parent!
  assert.equal(launcherBox.props.inert, '', 'the launcher (outside the dialog) is inert while open')

  const escape = ctx.key('Escape')
  await ctx.settle()
  assert.equal(escape.prevented, false)
  assert.equal(isOpen(ctx.widget), false)
  assert.equal(ctx.body.style.overflow, '')
  assert.equal(ctx.keydownListeners(), 0, 'the window listener exists only while open')
  assert.equal(launcherBox.props.inert, undefined)
  // The page is released BEFORE focus goes back: focus() on an inert opener does nothing.
  assert.deepEqual(ctx.events.slice(2), ['inert removed from div "Hỏi trợ lý AI"', 'focus opener'])
})

test('Tab wraps inside the open dialog; a key while closed does nothing', async (t) => {
  const ctx = await openWidget(t)
  assert.equal(ctx.key('Tab').prevented, false, 'no listener while closed')
  await openDialog(ctx)
  const backwards = ctx.key('Tab', { shiftKey: true })
  assert.equal(backwards.prevented, true, 'Shift+Tab on the first control wraps to the last')
  const last = ctx.events.at(-1)!
  assert.match(last, /^focus /)
  assert.notEqual(last, 'focus button [Quay lại]')
  const forwards = ctx.key('Tab')
  assert.equal(forwards.prevented, true, 'Tab on the last control wraps to the first')
  assert.equal(ctx.events.at(-1), 'focus button [Quay lại]')
  assert.equal(ctx.key('Tab').prevented, false, 'in the middle the browser moves on by itself')
})

test('the layout toggles the widget through what it exposes; the header close and back buttons close it', async (t) => {
  const ctx = await openWidget(t)
  const exposed = ctx.widget.instance as unknown as { toggleChatbot: () => void, isChatbotOpen: boolean }
  exposed.toggleChatbot()
  await ctx.settle()
  assert.equal(isOpen(ctx.widget), true)
  assert.equal(exposed.isChatbotOpen, true)
  await click(byLabel(ctx.widget, 'Đóng'))
  await ctx.settle()
  assert.equal(isOpen(ctx.widget), false)
  assert.equal(exposed.isChatbotOpen, false)
  exposed.toggleChatbot()
  await ctx.settle()
  await click(byLabel(ctx.widget, 'Quay lại'))
  await ctx.settle()
  assert.equal(isOpen(ctx.widget), false)
  exposed.toggleChatbot()
  await ctx.settle()
  exposed.toggleChatbot()
  await ctx.settle()
  assert.equal(isOpen(ctx.widget), false, 'toggle closes an open widget')
  assert.equal(ctx.body.style.overflow, '')
})

test('"Mở rộng toàn trang" closes the widget first, then goes to /assistant', async (t) => {
  const ctx = await openWidget(t)
  await openDialog(ctx)
  await click(byLabel(ctx.widget, 'Mở rộng toàn trang'))
  await ctx.settle()
  assert.equal(isOpen(ctx.widget), false)
  assert.deepEqual(ctx.navigations, ['/assistant'])
  const removed = ctx.events.indexOf('inert removed from div "Hỏi trợ lý AI"')
  assert.ok(removed !== -1 && removed < ctx.events.indexOf('navigate /assistant'), ctx.events.join(' | '))
})

test('on /assistant the launcher and its teaser are not shown', async (t) => {
  const ctx = await openWidget(t, chatServer(), { path: '/assistant' })
  assert.equal(launcher(ctx.widget), undefined)
  await ctx.tick(30_000)
  assert.doesNotMatch(words(ctx.widget), /Bạn cần tìm hiểu|Tôi có thể giúp bạn/)
  assert.ok(dialogOf(ctx.widget), 'the dialog itself is still there for the layout to open')
})

test('the teaser bubble: appears after 2 s, cycles, hides itself, opens the chat when clicked, and stays away once dismissed', async (t) => {
  const ctx = await openWidget(t)
  // After mounting: the SFC compiler's source-map sort uses Math.random too.
  t.mock.method(Math, 'random', () => 0)
  const teaserText = 'Bạn cần tìm hiểu về quyền lợi sau khi chấp hành xong án phạt tù?'
  await ctx.tick(1_999)
  assert.ok(!words(ctx.widget).includes(teaserText))
  await ctx.tick(1)
  assert.ok(words(ctx.widget).includes(teaserText), 'shown after 2 s')
  await ctx.tick(6_000)
  assert.ok(!words(ctx.widget).includes(teaserText), 'hidden 6 s later')
  await ctx.tick(2_000)
  assert.ok(words(ctx.widget).includes(teaserText), 'back on the 8 s cycle')
  // Two "Đóng" now: the dialog's and the teaser's.
  const teaserClose = byTag(ctx.widget, 'button').filter(el => el.props['aria-label'] === 'Đóng').find(el => el.props.class?.toString().includes('absolute'))!
  await click(teaserClose)
  await ctx.settle()
  assert.ok(!words(ctx.widget).includes(teaserText))
  await ctx.tick(60_000)
  assert.ok(!words(ctx.widget).includes(teaserText), 'a dismissed teaser never comes back')
  assert.equal(isOpen(ctx.widget), false, 'dismissing does not open the chat')
})

test('clicking the teaser opens the chat, and an opened chat never shows the teaser again', async (t) => {
  const ctx = await openWidget(t)
  t.mock.method(Math, 'random', () => 0.99)
  await ctx.tick(2_000)
  const teaser = findAll(ctx.widget.root, el => el.tag === 'div' && String(el.props.class).includes('rounded-[16px_16px_4px_16px]'))[0]
  assert.ok(teaser, 'the teaser is shown')
  assert.match(words(teaser), /Cần tư vấn về quyền học nghề/)
  await click(teaser)
  await ctx.settle()
  assert.equal(isOpen(ctx.widget), true)
  await click(byLabel(ctx.widget, 'Đóng'))
  await ctx.settle()
  await ctx.tick(60_000)
  assert.equal(findAll(ctx.widget.root, el => String(el.props.class).includes('rounded-[16px_16px_4px_16px]')).length, 0)
})

test('on a phone the full-screen dialog follows the visible viewport while open; the desktop panel is left alone', async (t) => {
  const phone = await openWidget(t, chatServer(), { viewport: { height: 480, offsetTop: 36 } })
  const style = (ctx: ChatCtx) => ({ ...(dialogOf(ctx.widget)!.props.style as Record<string, string>) })
  assert.deepEqual(style(phone), {})
  await openDialog(phone)
  assert.deepEqual(style(phone), { top: '36px', height: '480px' })
  phone.key('Escape')
  await phone.settle()
  assert.deepEqual(style(phone), {}, 'closed: the class sizes it again')
  phone.close()
  const desktop = await openWidget(t, chatServer(), { viewport: { height: 480, offsetTop: 36 }, media: { '(min-width: 768px)': true } })
  await openDialog(desktop)
  assert.deepEqual(style(desktop), {})
})

// ─── Sending and streaming ───────────────────────────────────────────────────

test('a question goes out with the session token and the honeypot; the reply streams in, in order, and lands complete', async (t) => {
  const ctx = await openWidget(t)
  await openDialog(ctx)
  const held = holdChat(ctx)
  await ask(ctx, '  Thủ tục xoá án tích?  ')

  assert.deepEqual(ctx.calls.slice(1).map(call => `${call.method} ${call.url.pathname}`), ['POST /api/public/chatbot/session', 'POST /api/public/chatbot'])
  const call = chatCalls(ctx)[0]!
  assert.equal(call.headers['x-chat-session'], 'tok.sig')
  assert.equal(call.headers.accept, 'text/event-stream')
  assert.deepEqual(call.body, { messages: [{ sender: 'user', text: 'Thủ tục xoá án tích?' }], _h: '' })
  // While waiting: the question is dimmed "Đang gửi…", ONE indicator, sending locked.
  assert.deepEqual(transcript(ctx.widget), [{ who: 'user', text: 'Thủ tục xoá án tích?' }])
  assert.match(words(bubbles(ctx.widget)[0]!), /Đang gửi…/)
  assert.equal(awaiting(ctx).length, 1)
  assert.equal(sendButton(ctx).props.disabled, true)
  assert.equal(mainInput(ctx.widget).props.disabled, true)

  const stream = held.release()
  stream.push(': ping\n\n')
  stream.push(content('Theo '))
  await ctx.settle()
  // The first word replaces the indicator in the same frame; the question is no longer "sending".
  assert.deepEqual(transcript(ctx.widget), [{ who: 'user', text: 'Thủ tục xoá án tích?' }, { who: 'bot', text: 'Theo' }])
  assert.equal(awaiting(ctx).length, 0)
  assert.doesNotMatch(words(bubbles(ctx.widget)[0]!), /Đang gửi…/)
  assert.deepEqual(parsedStorage(ctx)?.sessions[0]?.messages, [], 'a question in flight and a half-written answer are never saved')

  stream.push(content('Điều 70 '))
  stream.push(content('Bộ luật Hình sự.'))
  await ctx.settle()
  assert.equal(transcript(ctx.widget)[1]!.text, 'Theo Điều 70 Bộ luật Hình sự.')
  stream.push(meta({ kind: 'curated', sources: [SOURCE_7], followUps: ['Hồ sơ gồm những gì?'] }))
  stream.done()
  await ctx.settle()

  assert.equal(transcript(ctx.widget)[1]!.text, 'Theo Điều 70 Bộ luật Hình sự.')
  assert.ok(statuses(ctx.widget).includes('Trả lời từ nội dung đã phê duyệt'))
  assert.match(words(ctx.widget), /Tài liệu Hỏi – Đáp — STT 7/)
  assert.equal(buttonsWith(ctx.widget, 'Hồ sơ gồm những gì?').length, 1, 'follow-up chip under the newest answer')
  assert.equal(mainInput(ctx.widget).model?.value, '', 'the input is cleared on success')
  assert.equal(mainInput(ctx.widget).props.disabled, false)
  assert.deepEqual(alerts(ctx.widget), [])
  const saved = parsedStorage(ctx)!
  assert.equal(saved.sessions.length, 1)
  assert.equal(saved.sessions[0]!.title, 'Thủ tục xoá án tích?', 'titled from the first question')
  assert.equal(saved.sessions[0]!.token, 'tok.sig')
  assert.deepEqual(saved.sessions[0]!.messages.map(m => [m.sender, m.text]), [['user', 'Thủ tục xoá án tích?'], ['bot', 'Theo Điều 70 Bộ luật Hình sự.']])
  assert.deepEqual((saved.sessions[0]!.messages[1] as unknown as { sources: unknown[], followUps: string[] }).sources, [{ label: 'Tài liệu Hỏi – Đáp', reference: 'STT 7', url: null, entryId: 7 }])
  assert.deepEqual((saved.sessions[0]!.messages[1] as unknown as { followUps: string[] }).followUps, ['Hồ sơ gồm những gì?'])
})

test('scrolling: opening lands at the bottom; a send, a quick question and a retry first stop the follow at the new question', async (t) => {
  const ctx = await openWidget(t)
  await openDialog(ctx)
  assert.deepEqual(ctx.scrolls, ['release-anchor', 'pin'])
  const sends: string[][] = []
  const mark = () => ctx.scrolls.length
  for (const send of [
    async () => { ctx.server.state.chat.push(answer('Một.')); await ask(ctx, 'Câu một') },
    async () => { ctx.server.state.chat.push(answer('Hai.')); await click(button(ctx.widget, QUICK_QUESTIONS[0]!.question)); await ctx.settle() },
    async () => { ctx.server.state.chat.push(() => dropped()); await ask(ctx, 'Câu ba'); await input(mainInput(ctx.widget), 'x'); await ctx.settle() },
    async () => { ctx.server.state.chat.push(answer('Ba.')); await click(button(ctx.widget, 'Thử lại')); await ctx.settle() },
  ]) {
    const from = mark()
    await send()
    sends.push(ctx.scrolls.slice(from))
  }
  for (const [i, calls] of sends.entries()) {
    assert.equal(calls[0], 'follow-question', `send ${i}: ${calls.join(',')}`)
    assert.ok(calls.slice(1).every(c => c === 'pin'), `send ${i}: ${calls.join(',')}`)
  }
  assert.ok(ctx.scrolls.every(c => !c.includes('not wired')), 'the scroll box and its content are the refs handed over')
})

test('a second question reuses the conversation token and carries the history', async (t) => {
  const ctx = await openWidget(t)
  await openDialog(ctx)
  ctx.server.state.chat.push(answer('Trả lời một.'), answer('Trả lời hai.'))
  await ask(ctx, 'Câu một?')
  await ask(ctx, 'Câu hai?')
  assert.equal(ctx.calls.filter(call => call.url.pathname === '/api/public/chatbot/session').length, 1)
  assert.deepEqual(lastChatBody(ctx).messages, [
    { sender: 'user', text: 'Câu một?' }, { sender: 'bot', text: 'Trả lời một.' }, { sender: 'user', text: 'Câu hai?' },
  ])
  assert.deepEqual(transcript(ctx.widget).map(m => m.text), ['Câu một?', 'Trả lời một.', 'Câu hai?', 'Trả lời hai.'])
})

test('chatbot.replace swaps what was streamed for the official answer instead of appending to it', async (t) => {
  const ctx = await openWidget(t)
  await openDialog(ctx)
  const held = holdChat(ctx)
  await ask(ctx, 'Quần đảo Hoàng Sa của ai?')
  const stream = held.release()
  stream.push(content('Theo một số nguồn, quần đảo '))
  await ctx.settle()
  assert.equal(transcript(ctx.widget)[1]!.text, 'Theo một số nguồn, quần đảo')
  const OFFICIAL = 'Hoàng Sa và Trường Sa là một phần lãnh thổ không thể tách rời của Việt Nam.'
  // What the server writes: `content` for an older widget (which can only append), `replace` for this one.
  stream.push({ choices: [{ delta: { content: `\n\n${OFFICIAL}` } }], chatbot: { replace: OFFICIAL } })
  stream.push(': ping\n\n')
  await ctx.settle()
  assert.equal(transcript(ctx.widget)[1]!.text, OFFICIAL)
  stream.push(meta({ kind: 'curated', sources: [] }))
  stream.done()
  await ctx.settle()
  assert.equal(transcript(ctx.widget)[1]!.text, OFFICIAL, 'nothing of the withdrawn text survives')
  assert.equal(parsedStorage(ctx)!.sessions[0]!.messages[1]!.text, OFFICIAL, 'storage holds only the official answer')
})

test('frames split across reads, tool events and a stream cut without [DONE] still land one complete answer', async (t) => {
  const ctx = await openWidget(t)
  await openDialog(ctx)
  const held = holdChat(ctx)
  await ask(ctx, 'Tìm bài viết?')
  const stream = held.release()
  stream.push(`data: ${JSON.stringify({ choices: [], chatbot: { toolEvent: { name: 'search_c11_articles', query: 'tái hòa nhập', status: 'calling' } } })}\n\n`)
  await ctx.settle()
  assert.match(words(ctx.widget), /Đang tra cứu dữ liệu thực tế từ hệ thống/)
  const frame = `data: ${JSON.stringify(content('Có hai bài.'))}\n\n`
  stream.push(frame.slice(0, 17))
  stream.push(frame.slice(17))
  stream.push(`data: ${JSON.stringify({ choices: [], chatbot: { toolEvent: { name: 'search_c11_articles', query: 'tái hòa nhập', status: 'done', count: 2 } } })}\n\n`)
  stream.end()
  await ctx.settle()
  assert.equal(transcript(ctx.widget)[1]!.text, 'Có hai bài.')
  assert.match(words(ctx.widget), /Tìm bài viết & mô hình C11 \(search_c11_articles\) 2 kết quả/)
  // No metadata frame: the reply is labelled "unavailable" rather than passed off as approved.
  assert.ok(statuses(ctx.widget).includes('Dịch vụ tạm thời chưa sẵn sàng'))
  assert.deepEqual(alerts(ctx.widget), [])
})

test('a dropped connection keeps the question with "Thử lại"; retrying sends it again and clears the error', async (t) => {
  const ctx = await openWidget(t)
  await openDialog(ctx)
  ctx.server.state.chat.push(() => dropped())
  await ask(ctx, 'Hỏi lúc mất mạng')
  // The question's own error and "Thử lại" show at once, beside the line under the input
  // (FINDING-C1, fixed: they used to wait for the next repaint — the visitor typing).
  assert.deepEqual(alerts(ctx.widget), [
    'Không thể gửi câu hỏi. Vui lòng thử lại. Thử lại',
    'Không thể nhận phản hồi lúc này. Nội dung câu hỏi đã được giữ lại để bạn thử lại.',
  ])
  assert.equal(mainInput(ctx.widget).model?.value, 'Hỏi lúc mất mạng', 'the question is back in the input')
  assert.equal(mainInput(ctx.widget).props['aria-invalid'], true)
  assert.equal(mainInput(ctx.widget).props['aria-describedby'], 'public-chatbot-error public-chatbot-counter')
  assert.deepEqual(parsedStorage(ctx)!.sessions[0]!.messages, [], 'a failed question is not saved (its title is)')
  assert.equal(parsedStorage(ctx)!.sessions[0]!.title, 'Hỏi lúc mất mạng')
  assert.match(String(bubbles(ctx.widget)[0]!.props.class), /bg-danger-bg/)

  ctx.server.state.chat.push(answer('Đã nhận.'))
  await click(button(ctx.widget, 'Thử lại'))
  await ctx.settle()
  assert.deepEqual(transcript(ctx.widget), [{ who: 'user', text: 'Hỏi lúc mất mạng' }, { who: 'bot', text: 'Đã nhận.' }])
  assert.deepEqual(alerts(ctx.widget), [])
  assert.deepEqual(lastChatBody(ctx).messages, [{ sender: 'user', text: 'Hỏi lúc mất mạng' }], 'the failed copy is not sent as history')
})

test('429: the server sentence is shown in the bubble and under the input; the question stays for later', async (t) => {
  const ctx = await openWidget(t)
  await openDialog(ctx)
  ctx.server.state.chat.push(() => json({ statusCode: 429, message: 'Bạn gửi quá nhiều yêu cầu. Vui lòng thử lại sau.' }, 429))
  await ask(ctx, 'Hỏi nhanh')
  // At once, without a repaint from the visitor typing (FINDING-C1, fixed).
  assert.deepEqual(alerts(ctx.widget), [
    'Bạn gửi quá nhiều yêu cầu. Vui lòng thử lại sau. Thử lại',
    'Bạn gửi quá nhiều yêu cầu. Vui lòng thử lại sau.',
  ])
  assert.deepEqual(transcript(ctx.widget), [{ who: 'user', text: 'Hỏi nhanh' }])
  assert.equal(mainInput(ctx.widget).model?.value, 'Hỏi nhanh')
})

test('FINDING-C1 (fixed): a failed send — no connection, 429, empty stream — stops "Đang gửi…" and offers "Thử lại" with no repaint from the visitor', async (t) => {
  // The bug: `submitBotQuestion` wrote `status = 'error'` on the raw object it had pushed
  // into the reactive transcript, so the change scheduled no render; the last render had run
  // while the question was still 'pending'. The screen only caught up when something else
  // repainted the widget (the visitor typing). Each case below reads the widget right after
  // the send settles, touching nothing.
  const cases: Array<{ label: string, reply: (call: NetCall) => Response | Error, bubble: string }> = [
    { label: 'no connection', reply: () => dropped(), bubble: 'Không thể gửi câu hỏi. Vui lòng thử lại.' },
    { label: '429', reply: () => json({ statusCode: 429, message: 'Bạn gửi quá nhiều yêu cầu. Vui lòng thử lại sau.' }, 429), bubble: 'Bạn gửi quá nhiều yêu cầu. Vui lòng thử lại sau.' },
    { label: 'empty stream', reply: (call) => { const s = sseStream(call.signal); s.done(); return s.response }, bubble: 'Không thể gửi câu hỏi. Vui lòng thử lại.' },
  ]
  for (const { label, reply, bubble } of cases) {
    const ctx = await openWidget(t)
    await openDialog(ctx)
    ctx.server.state.chat.push(reply)
    await ask(ctx, `Hỏi (${label})`)
    const question = bubbles(ctx.widget)[0]!
    assert.doesNotMatch(words(question), /Đang gửi…/, `${label}: the question still reads "Đang gửi…"`)
    assert.doesNotMatch(String(question.props.class), /opacity-60/, `${label}: the question is still dimmed as sending`)
    assert.match(String(question.props.class), /bg-danger-bg/, `${label}: the question is not marked failed`)
    assert.equal(buttonsWith(ctx.widget, 'Thử lại').length, 1, `${label}: no "Thử lại"`)
    assert.equal(alerts(ctx.widget)[0], `${bubble} Thử lại`, `${label}: the question's own error`)
    ctx.close()
  }
  // A later question in the conversation: that one is marked failed, the answered one is not.
  const ctx = await openWidget(t)
  await openDialog(ctx)
  ctx.server.state.chat.push(answer('Trả lời một.'), () => dropped())
  await ask(ctx, 'Câu một')
  await ask(ctx, 'Câu hai')
  assert.deepEqual(transcript(ctx.widget), [{ who: 'user', text: 'Câu một' }, { who: 'bot', text: 'Trả lời một.' }, { who: 'user', text: 'Câu hai' }])
  const [first, , second] = bubbles(ctx.widget)
  assert.doesNotMatch(words(second!), /Đang gửi…/)
  assert.match(String(second!.props.class), /bg-danger-bg/)
  assert.match(words(second!), /Không thể gửi câu hỏi\. Vui lòng thử lại\. Thử lại$/)
  assert.equal(words(first!), 'Câu một', 'the answered question is untouched')
  assert.doesNotMatch(String(first!.props.class), /bg-danger-bg|opacity-60/)
})

test('400 input_too_long: the question leaves the transcript, the draft stays, and the input adopts the server limit', async (t) => {
  const ctx = await openWidget(t)
  await openDialog(ctx)
  const long = 'Xin hỏi về thủ tục xoá án tích '.repeat(40).trim()
  ctx.server.state.chat.push(() => json({ statusCode: 400, message: 'Câu hỏi không được vượt quá 500 ký tự. Vui lòng rút gọn rồi gửi lại.', data: { reason: 'input_too_long', maxChars: 500 } }, 400))
  await ask(ctx, long)
  assert.deepEqual(transcript(ctx.widget), [])
  assert.deepEqual(alerts(ctx.widget), ['Câu hỏi không được vượt quá 500 ký tự. Vui lòng rút gọn rồi gửi lại.'])
  assert.equal(mainInput(ctx.widget).model?.value, long)
  assert.equal(mainInput(ctx.widget).props.maxlength, 500)
  assert.equal(words(byId(ctx.widget, 'public-chatbot-counter')!), `${long.length}/500`)
  assert.match(String(byId(ctx.widget, 'public-chatbot-counter')!.props.class), /!text-\[#b42318\]/, 'over 90 % of the limit reads red')
})

test('the browser stops an over-long or empty question before any request', async (t) => {
  const ctx = await openWidget(t)
  await openDialog(ctx)
  assert.equal(sendButton(ctx).props.disabled, true, 'nothing typed: nothing to send')
  await input(mainInput(ctx.widget), '   ')
  assert.equal(sendButton(ctx).props.disabled, true)
  await fire(sendForm(ctx.widget), 'submit')
  await ctx.settle()
  assert.deepEqual(alerts(ctx.widget), ['Vui lòng nhập câu hỏi.'])
  await ask(ctx, 'a'.repeat(2001))
  assert.deepEqual(alerts(ctx.widget), ['Câu hỏi không được vượt quá 2000 ký tự. Vui lòng rút gọn rồi gửi lại.'])
  assert.equal(chatCalls(ctx).length, 0)
  assert.equal(mainInput(ctx.widget).props.maxlength, 2000)
  assert.equal(words(byId(ctx.widget, 'public-chatbot-counter')!), '2001/2000')
})

test('a filled honeypot sends nothing', async (t) => {
  const ctx = await openWidget(t)
  await openDialog(ctx)
  const honeypot = findAll(ctx.widget.root, el => el.tag === 'input' && el.props.name === '_h')[0]!
  assert.equal(honeypot.props.tabindex, '-1')
  await input(honeypot, 'http://spam.example')
  await ask(ctx, 'Câu hỏi của bot')
  assert.equal(ctx.calls.length, 1, 'only the quick questions were ever requested')
  assert.deepEqual(transcript(ctx.widget), [])
})

test('an empty stream is a failure, not a blank answer', async (t) => {
  const ctx = await openWidget(t)
  await openDialog(ctx)
  ctx.server.state.chat.push((call) => { const s = sseStream(call.signal); s.done(); return s.response })
  await ask(ctx, 'Có ai không?')
  assert.deepEqual(transcript(ctx.widget), [{ who: 'user', text: 'Có ai không?' }])
  assert.deepEqual(alerts(ctx.widget), [
    'Không thể gửi câu hỏi. Vui lòng thử lại. Thử lại',
    'Không thể nhận phản hồi lúc này. Nội dung câu hỏi đã được giữ lại để bạn thử lại.',
  ], 'the question\'s own error shows at once (FINDING-C1, fixed)')
  assert.equal(mainInput(ctx.widget).model?.value, 'Có ai không?')
})

test('a refused question (moderation_blocked) leaves the transcript and storage; the refusal stays', async (t) => {
  const ctx = await openWidget(t)
  await openDialog(ctx)
  ctx.server.state.chat.push(answer('Nội dung không phù hợp.', { kind: 'moderation_blocked', sources: [] }))
  await ask(ctx, 'câu vi phạm')
  assert.deepEqual(transcript(ctx.widget), [{ who: 'bot', text: 'Nội dung không phù hợp.' }])
  assert.deepEqual(parsedStorage(ctx)!.sessions[0]!.messages.map(m => m.text), ['Nội dung không phù hợp.'])
  ctx.server.state.chat.push(answer('Được.'))
  await ask(ctx, 'Câu sạch?')
  assert.ok(!lastChatBody(ctx).messages.some(m => m.text === 'câu vi phạm'), 'never sent again as history')
})

test('FINDING-C2 (current behaviour, NOT a contract): a refused first question stays as the conversation title', async (t) => {
  // The 400 "rejected" path restores the title it auto-set from the question; the
  // moderation_blocked path removes the question but keeps the title — on this device only
  // (titles are never sent), shown in the conversation list. Pinned so a split cannot
  // change it silently.
  const ctx = await openWidget(t)
  await openDialog(ctx)
  ctx.server.state.chat.push(answer('Nội dung không phù hợp.', { kind: 'moderation_blocked', sources: [] }))
  await ask(ctx, 'câu vi phạm')
  assert.equal(parsedStorage(ctx)!.sessions[0]!.title, 'câu vi phạm')
  await click(historyButton(ctx))
  await ctx.settle()
  assert.match(words(ctx.widget), /câu vi phạm 1 tin nhắn/)
})

// ─── What the verifier's probes caught that this suite did not (F3) ──────────

const REFUSED = () => answer('Nội dung không phù hợp.', { kind: 'moderation_blocked', sources: [] })
/** The "Thử lại" inside one question's bubble. */
const retryIn = (bubble: Parameters<typeof words>[0]) => findAll(bubble, el => el.tag === 'button' && words(el) === 'Thử lại')[0]!

test('a failed question keeps the title it gave, shown in the list; a question refused after it leaves that title', async (t) => {
  const ctx = await openWidget(t)
  await openDialog(ctx)
  ctx.server.state.chat.push(() => dropped(), REFUSED())
  await ask(ctx, 'Câu một')
  await click(historyButton(ctx))
  await ctx.settle()
  assert.match(words(ctx.widget), /Câu một 1 tin nhắn/, 'the failed question is still there, and titles the conversation')
  await click(historyButton(ctx))
  await ctx.settle()
  await ask(ctx, 'câu vi phạm')
  assert.deepEqual(transcript(ctx.widget).map(m => m.text), ['Câu một', 'Nội dung không phù hợp.'])
  assert.equal(buttonsWith(ctx.widget, 'Thử lại').length, 1, '"Câu một" can still be retried')
  assert.equal(parsedStorage(ctx)!.sessions[0]!.title, 'Câu một')
})

test('the same words asked twice: the second, failed one is the one marked; the answered one is untouched', async (t) => {
  const ctx = await openWidget(t)
  await openDialog(ctx)
  ctx.server.state.chat.push(answer('Một.'), () => dropped())
  await ask(ctx, 'Giống nhau')
  await ask(ctx, 'Giống nhau')
  const [first, , second] = bubbles(ctx.widget)
  assert.equal(words(first!), 'Giống nhau')
  assert.doesNotMatch(String(first!.props.class), /bg-danger-bg|opacity-60/)
  assert.match(String(second!.props.class), /bg-danger-bg/)
  assert.match(words(second!), /Thử lại$/)
})

test('a second submit while the first question waits sends nothing and adds no question', async (t) => {
  const ctx = await openWidget(t)
  await openDialog(ctx)
  const held = holdChat(ctx)
  await ask(ctx, 'Câu một')
  await input(mainInput(ctx.widget), 'Câu hai')
  await fire(sendForm(ctx.widget), 'submit')
  await ctx.settle()
  assert.equal(chatCalls(ctx).length, 1)
  assert.deepEqual(transcript(ctx.widget), [{ who: 'user', text: 'Câu một' }])
  const stream = held.release()
  stream.push(content('Trả lời.'))
  stream.done()
  await ctx.settle()
  assert.deepEqual(transcript(ctx.widget).map(m => m.text), ['Câu một', 'Trả lời.'], 'no question left waiting')
  assert.ok(!bubbles(ctx.widget).some(bubble => /Đang gửi…/.test(words(bubble))))
})

test('"Thử lại" sends the failed question as asked, not what the input holds by then', async (t) => {
  const ctx = await openWidget(t)
  await openDialog(ctx)
  ctx.server.state.chat.push(() => dropped(), answer('Đã nhận.'))
  await ask(ctx, 'Câu gốc')
  await input(mainInput(ctx.widget), 'Câu khác đang soạn')
  await ctx.settle()
  await click(retryIn(bubbles(ctx.widget)[0]!))
  await ctx.settle()
  assert.deepEqual(lastChatBody(ctx).messages, [{ sender: 'user', text: 'Câu gốc' }])
  assert.deepEqual(transcript(ctx.widget), [{ who: 'user', text: 'Câu gốc' }, { who: 'bot', text: 'Đã nhận.' }])
})

test('waiting 20 s for the first word says so inside the status region; the first word clears it', async (t) => {
  const ctx = await openWidget(t)
  await openDialog(ctx)
  const held = holdChat(ctx)
  await ask(ctx, 'Câu chậm?')
  await ctx.tick(19_999)
  assert.ok(!awaiting(ctx)[0]!.includes('Đang chờ lâu hơn bình thường'))
  await ctx.tick(1)
  assert.match(awaiting(ctx)[0]!, /Đang chờ lâu hơn bình thường, xin anh\/chị chờ thêm…/)
  const stream = held.release()
  stream.push(content('Đây.'))
  await ctx.settle()
  assert.equal(awaiting(ctx).length, 0)
  assert.doesNotMatch(words(ctx.widget), /Đang chờ lâu hơn/)
  stream.done()
  await ctx.settle()
})

// ─── In-flight work and the conversation it belongs to ───────────────────────

test('a new conversation mid-answer aborts the old request silently, and the aborted one cannot disturb the next send', async (t) => {
  const ctx = await openWidget(t)
  await openDialog(ctx)
  const first = holdChat(ctx)
  await ask(ctx, 'Câu ở cuộc A')
  const streamA = first.release()
  streamA.push(content('Đang trả lời A'))
  await ctx.settle()
  const callA = chatCalls(ctx)[0]!

  const second = holdChat(ctx)
  await click(historyButton(ctx))
  await ctx.settle()
  // Same turn: create B, then ask in B — before A's abort has been delivered.
  await click(button(ctx.widget, 'Tạo mới'))
  await input(mainInput(ctx.widget), 'Câu ở cuộc B')
  await fire(sendForm(ctx.widget), 'submit')
  await ctx.settle()

  assert.equal(callA.signal?.aborted, true, 'the old request is cancelled')
  assert.deepEqual(alerts(ctx.widget), [], 'a cancelled request is not an error')
  assert.deepEqual(transcript(ctx.widget), [{ who: 'user', text: 'Câu ở cuộc B' }])
  assert.equal(awaiting(ctx).length, 1, "B is still waiting: A's late abort must not reset B's request")
  assert.equal(sendButton(ctx).props.disabled, true)
  streamA.push(content(' muộn'))
  const streamB = second.release()
  streamB.push(content('Trả lời B.'))
  streamB.done()
  await ctx.settle()
  assert.deepEqual(transcript(ctx.widget).map(m => m.text), ['Câu ở cuộc B', 'Trả lời B.'])
  const saved = parsedStorage(ctx)!
  assert.equal(saved.sessions.length, 2)
  assert.deepEqual(saved.sessions[0]!.messages.map(m => m.text), ['Câu ở cuộc B', 'Trả lời B.'])
  assert.ok(!JSON.stringify(saved).includes('Đang trả lời A'), "A's partial answer is gone")
})

test('closing the dialog mid-answer does not cancel it: reopening shows the finished answer', async (t) => {
  const ctx = await openWidget(t)
  await openDialog(ctx)
  const held = holdChat(ctx)
  await ask(ctx, 'Câu dài?')
  ctx.key('Escape')
  await ctx.settle()
  const stream = held.release()
  stream.push(content('Xong rồi.'))
  stream.done()
  await ctx.settle()
  await openDialog(ctx)
  assert.deepEqual(transcript(ctx.widget).map(m => m.text), ['Câu dài?', 'Xong rồi.'])
  assert.equal(chatCalls(ctx)[0]!.signal?.aborted, false)
})

// ─── Conversations and what is kept on the device ────────────────────────────

test('a returning visitor gets their saved conversations back, on the one they had open', async (t) => {
  const sessions = [
    { id: 'conv-a', token: 'tok-a', title: 'Hỏi về vay vốn', createdAt: Date.UTC(2026, 9, 20), messages: [{ sender: 'user', text: 'Vay vốn?' }, { sender: 'bot', text: 'Được vay tối đa 100 triệu.', kind: 'curated', sources: [{ label: 'Nghị định 49', reference: 'Điều 4', url: 'https://vbpl.vn/nd49', entryId: 3 }] }] },
    { id: 'conv-b', token: null, title: 'Hỏi về học nghề', createdAt: Date.UTC(2026, 9, 21), messages: [{ sender: 'user', text: 'Học nghề?' }, { sender: 'bot', text: 'Miễn phí.', kind: 'provider' }] },
  ]
  const ctx = await openWidget(t, chatServer(), { local: SAVED(sessions, 'conv-b') })
  await openDialog(ctx)
  assert.deepEqual(transcript(ctx.widget).map(m => m.text), ['Học nghề?', 'Miễn phí.'])
  assert.ok(statuses(ctx.widget).includes('Giải thích có tham chiếu nội dung đã phê duyệt'))

  await click(historyButton(ctx))
  await ctx.settle()
  assert.equal(historyButton(ctx).props['aria-expanded'], true)
  assert.match(words(ctx.widget), /Hỏi về vay vốn 2 tin nhắn · 20\/10\/2026/)
  assert.match(words(ctx.widget), /Hỏi về học nghề 2 tin nhắn · 21\/10\/2026/)
  await click(button(ctx.widget, 'Hỏi về vay vốn'))
  await ctx.settle()
  assert.equal(historyButton(ctx).props['aria-expanded'], false, 'picking one closes the list')
  assert.deepEqual(transcript(ctx.widget).map(m => m.text), ['Vay vốn?', 'Được vay tối đa 100 triệu.'])
  const link = findAll(ctx.widget.root, el => el.tag === 'a' && el.props.href === 'https://vbpl.vn/nd49')[0]
  assert.ok(link, 'a saved https source is still a link')
  assert.equal(link.props.rel, 'noopener noreferrer')
  assert.equal(parsedStorage(ctx)!.activeId, 'conv-a')

  ctx.server.state.chat.push(answer('Thêm.'))
  await ask(ctx, 'Lãi suất?')
  assert.equal(chatCalls(ctx)[0]!.headers['x-chat-session'], 'tok-a', 'the saved token is reused, no new session')
  assert.equal(ctx.calls.filter(call => call.url.pathname === '/api/public/chatbot/session').length, 0)
})

test('the single-conversation history of the previous version is carried over once', async (t) => {
  const legacy = JSON.stringify([{ sender: 'user', text: 'Câu cũ' }, { sender: 'bot', text: 'Trả lời cũ', kind: 'curated' }])
  const ctx = await openWidget(t, chatServer(), { local: { cdkt_chat_history_v2: legacy } })
  await openDialog(ctx)
  assert.deepEqual(transcript(ctx.widget).map(m => m.text), ['Câu cũ', 'Trả lời cũ'])
  assert.equal(ctx.local.getItem('cdkt_chat_history_v2'), null)
  assert.equal(parsedStorage(ctx)!.sessions[0]!.title, 'Cuộc trò chuyện trước')
})

test('unreadable saved data is dropped instead of breaking the widget', async (t) => {
  const ctx = await openWidget(t, chatServer(), { local: { cdkt_sessions_v1: '{not json' } })
  await openDialog(ctx)
  assert.equal(ctx.local.getItem('cdkt_sessions_v1'), null)
  assert.deepEqual(transcript(ctx.widget), [])
  ctx.server.state.chat.push(answer('Chào.'))
  await ask(ctx, 'Xin chào')
  assert.equal(parsedStorage(ctx)!.sessions.length, 1)
})

test('create, switch, delete and clear conversations from the header and the list', async (t) => {
  const ctx = await openWidget(t)
  await openDialog(ctx)
  ctx.server.state.chat.push(answer('Trả lời A.'), answer('Trả lời B.'))
  await ask(ctx, 'Câu A')
  await click(historyButton(ctx))
  await ctx.settle()
  await click(button(ctx.widget, 'Tạo mới'))
  await ctx.settle()
  assert.equal(historyButton(ctx).props['aria-expanded'], false)
  assert.deepEqual(transcript(ctx.widget), [], 'a new conversation starts empty')
  await ask(ctx, 'Câu B')
  assert.deepEqual(parsedStorage(ctx)!.sessions.map(s => s.title), ['Câu B', 'Câu A'], 'newest first')

  await click(historyButton(ctx))
  await ctx.settle()
  const current = findAll(ctx.widget.root, el => el.tag === 'button' && el.props['aria-current'] === 'true')
  assert.equal(current.length, 1)
  assert.match(words(current[0]!), /^Câu B/)
  await click(byLabel(ctx.widget, 'Xóa Câu B'))
  await ctx.settle()
  assert.deepEqual(transcript(ctx.widget).map(m => m.text), ['Câu A', 'Trả lời A.'], 'deleting the open one lands on the newest survivor')
  assert.deepEqual(parsedStorage(ctx)!.sessions.map(s => s.title), ['Câu A'])

  await click(byLabel(ctx.widget, 'Xóa lịch sử'))
  await ctx.settle()
  assert.deepEqual(transcript(ctx.widget), [])
  const saved = parsedStorage(ctx)!
  assert.deepEqual(saved.sessions.map(s => [s.title, s.messages.length]), [['Cuộc trò chuyện mới', 0]])

  await click(byLabel(ctx.widget, 'Xóa Cuộc trò chuyện mới'))
  await ctx.settle()
  assert.equal(parsedStorage(ctx)!.sessions.length, 1, 'deleting the last one leaves a fresh one, never none')
  assert.match(words(ctx.widget), /Cuộc trò chuyện mới Chưa có tin nhắn · 29\/10\/2026/)
})

// ─── Quick questions, follow-ups ─────────────────────────────────────────────

test('a quick question is asked as typed by the visitor; the chips lock while an answer is coming', async (t) => {
  const ctx = await openWidget(t)
  await openDialog(ctx)
  assert.ok(statuses(ctx.widget).includes('Câu hỏi gợi ý từ kho dữ liệu đã phê duyệt'))
  const held = holdChat(ctx)
  await click(button(ctx.widget, QUICK_QUESTIONS[1]!.question))
  await ctx.settle()
  assert.deepEqual(lastChatBody(ctx).messages, [{ sender: 'user', text: QUICK_QUESTIONS[1]!.question }])
  for (const q of QUICK_QUESTIONS) assert.equal(button(ctx.widget, q.question).props.disabled, true)
  const stream = held.release()
  stream.push(content('Có.'))
  stream.done()
  await ctx.settle()
  assert.equal(button(ctx.widget, QUICK_QUESTIONS[0]!.question).props.disabled, false)
  // The strip folds away and back.
  const toggle = button(ctx.widget, 'Câu hỏi gợi ý')
  const chips = button(ctx.widget, QUICK_QUESTIONS[0]!.question).parent!.parent!
  assert.equal(isShown(chips), true)
  await click(toggle)
  await ctx.settle()
  assert.equal(isShown(chips), false)
})

test('quick questions that failed or came back empty say so, and are fetched again when the chat opens', async (t) => {
  const server = chatServer()
  server.state.quickQuestions = () => json({ statusCode: 503 }, 503)
  const ctx = await openWidget(t, server)
  assert.ok(statuses(ctx.widget).includes('Hiện không thể tải câu hỏi gợi ý. Bạn vẫn có thể nhập câu hỏi bên dưới.'))
  server.state.quickQuestions = () => json({ ok: true, available: false, items: [] })
  await openDialog(ctx)
  assert.equal(ctx.calls.filter(call => call.url.pathname === '/api/public/chatbot/quick-questions').length, 2)
  assert.ok(statuses(ctx.widget).includes('Hiện chưa có câu hỏi gợi ý đã được phê duyệt. Bạn vẫn có thể nhập câu hỏi bên dưới.'))
  await click(byLabel(ctx.widget, 'Đóng'))
  await ctx.settle()
  server.state.quickQuestions = () => json({ ok: true, available: true, items: QUICK_QUESTIONS })
  await openDialog(ctx)
  assert.equal(buttonsWith(ctx.widget, QUICK_QUESTIONS[0]!.question).length, 1)
  await click(byLabel(ctx.widget, 'Đóng'))
  await ctx.settle()
  await openDialog(ctx)
  assert.equal(ctx.calls.filter(call => call.url.pathname === '/api/public/chatbot/quick-questions').length, 3, 'loaded ones are not fetched again')
})

test('follow-up chips sit under the newest finished answer only, and ask their question', async (t) => {
  const ctx = await openWidget(t)
  await openDialog(ctx)
  ctx.server.state.chat.push(
    answer('Một.', { kind: 'curated', sources: [], followUps: ['Hỏi tiếp một?', 'Hỏi tiếp hai?'] }),
    answer('Hai.', { kind: 'curated', sources: [], followUps: ['Hỏi tiếp ba?'] }),
  )
  await ask(ctx, 'Bắt đầu')
  assert.equal(findAll(ctx.widget.root, el => el.props.role === 'group').length, 1)
  await click(button(ctx.widget, 'Hỏi tiếp hai?'))
  await ctx.settle()
  assert.deepEqual(lastChatBody(ctx).messages.at(-1), { sender: 'user', text: 'Hỏi tiếp hai?' })
  assert.equal(buttonsWith(ctx.widget, 'Hỏi tiếp một?').length, 0, 'the earlier chips are gone')
  assert.equal(buttonsWith(ctx.widget, 'Hỏi tiếp ba?').length, 1)
})

// ─── What hangs under an answer ──────────────────────────────────────────────

test('a cited source opens in place: loading, the approved text, a link to the full page; collapsing keeps it', async (t) => {
  const server = chatServer()
  const ctx = await openWidget(t, server)
  await openDialog(ctx)
  server.state.chat.push(answer('Xem nguồn.', { kind: 'curated', sources: [SOURCE_7] }))
  await ask(ctx, 'Nguồn?')
  let pending: ((r: Response) => void) | null = null
  server.state.sources = (call) => { pending = call.respond; return HOLD }
  const toggle = button(ctx.widget, 'Xem đầy đủ')
  assert.equal(toggle.props['aria-expanded'], false)
  await click(toggle)
  await ctx.settle()
  assert.ok(statuses(ctx.widget).includes('Đang tải nội dung đầy đủ…'))
  assert.equal(button(ctx.widget, 'Thu gọn').props['aria-expanded'], true)
  pending!(json({ ok: true, source: { question: 'Thủ tục xoá án tích?', answer: 'Theo Điều 70…\nKhoản 2.' } }))
  await ctx.settle()
  // NFKC on the way in: "…" arrives as "...".
  assert.match(words(ctx.widget), /Thủ tục xoá án tích\? Theo Điều 70\.\.\. Khoản 2\. Mở trong Tài liệu Hỏi – Đáp →/)
  const link = findAll(ctx.widget.root, el => el.tag === 'nuxt-link')[0]!
  assert.equal(link.props.to, '/qa-documents#qa-7')
  await click(button(ctx.widget, 'Thu gọn'))
  await ctx.settle()
  assert.doesNotMatch(words(ctx.widget), /Khoản 2/)
  await click(button(ctx.widget, 'Xem đầy đủ'))
  await ctx.settle()
  assert.match(words(ctx.widget), /Khoản 2/)
  assert.equal(ctx.calls.filter(call => call.url.pathname === '/api/public/chatbot/sources').length, 1, 'read once')
  assert.equal(ctx.calls.find(call => call.url.pathname === '/api/public/chatbot/sources')!.url.search, '?id=7')
})

test('a source that fails to load says so with "Thử lại", which repeats that one request', async (t) => {
  const server = chatServer()
  const ctx = await openWidget(t, server)
  await openDialog(ctx)
  server.state.chat.push(answer('Xem nguồn.', { kind: 'curated', sources: [SOURCE_7] }))
  await ask(ctx, 'Nguồn?')
  server.state.sources = () => json({ statusCode: 503 }, 503)
  await click(button(ctx.widget, 'Xem đầy đủ'))
  await ctx.settle()
  assert.deepEqual(alerts(ctx.widget), ['Không tải được nội dung đầy đủ. Thử lại'])
  server.state.sources = () => json({ ok: true, source: { question: '', answer: 'Nội dung.' } })
  await click(button(ctx.widget, 'Thử lại'))
  await ctx.settle()
  assert.deepEqual(alerts(ctx.widget), [])
  assert.match(words(ctx.widget), /Nội dung\. Mở trong Tài liệu Hỏi – Đáp/)
  assert.equal(ctx.calls.filter(call => call.url.pathname === '/api/public/chatbot/sources').length, 2)
})

test('the contact form under an answer: a phone or an email is required, then it is sent once', async (t) => {
  const server = chatServer()
  const ctx = await openWidget(t, server)
  await openDialog(ctx)
  server.state.chat.push(answer('Cán bộ sẽ liên hệ.', { kind: 'not_found', sources: [], askContact: true }))
  await ask(ctx, 'Tôi cần gặp cán bộ')
  assert.ok(statuses(ctx.widget).includes('Chưa tìm thấy thông tin phù hợp'))
  const form = findAll(ctx.widget.root, el => el.tag === 'form' && words(el).includes('Để lại thông tin liên hệ'))[0]!
  const field = (name: string) => findAll(form, el => (el.tag === 'input' || el.tag === 'textarea') && String(el.props.id).endsWith(`-${name}`))[0]!
  await input(field('name'), 'Nguyễn Văn An')
  await fire(form, 'submit')
  await ctx.settle()
  assert.deepEqual(alerts(ctx.widget), ['Vui lòng nhập số điện thoại hoặc email để cán bộ liên hệ.'])
  assert.equal(field('phone').props['aria-invalid'], 'true')
  assert.equal(field('phone').props['aria-describedby'], field('phone').props.id.toString().replace(/-phone$/, '-error'))

  server.state.lead = () => json({ statusCode: 429, statusMessage: 'Bạn đã gửi quá nhiều lần.' }, 429)
  await input(field('phone'), '0903480985')
  await fire(form, 'submit')
  await ctx.settle()
  assert.deepEqual(alerts(ctx.widget), ['Bạn đã gửi quá nhiều lần.'])
  server.state.lead = () => json({ ok: true })
  await input(field('question'), 'Hỗ trợ việc làm')
  await fire(form, 'submit')
  await ctx.settle()
  assert.match(words(ctx.widget), /Đã gửi thông tin\. Cán bộ sẽ liên hệ/)
  const leads = ctx.calls.filter(call => call.url.pathname === '/api/public/chatbot/lead')
  assert.equal(leads.length, 2)
  assert.deepEqual(leads.at(-1)!.body, { name: 'Nguyễn Văn An', phone: '0903480985', email: '', question: 'Hỗ trợ việc làm' })
})

test('"Sao chép" copies the answer text and says so for 2 s', async (t) => {
  const ctx = await openWidget(t)
  await openDialog(ctx)
  ctx.server.state.chat.push(answer('**Hotline** 0903.480.985'))
  await ask(ctx, 'Số hotline?')
  await click(button(ctx.widget, 'Sao chép'))
  await ctx.settle()
  assert.deepEqual(ctx.clipboard, ['**Hotline** 0903.480.985'])
  assert.equal(buttonsWith(ctx.widget, 'Đã chép').length, 1)
  await ctx.tick(2_000)
  assert.equal(buttonsWith(ctx.widget, 'Đã chép').length, 0)
  assert.equal(buttonsWith(ctx.widget, 'Sao chép').length, 1)
})
