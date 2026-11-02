/**
 * Ô hỏi của chatbot trống NGAY khi câu hỏi được gửi — không phải khi câu trả lời đã về.
 *
 * Người dùng báo (2026-11-02, bản build): câu vừa gửi nằm nguyên trong ô suốt lúc bot trả
 * lời, chỉ biến mất khi trả lời xong. Gốc: `submitBotQuestion` (`app/composables/chatbot/
 * send.ts`, dùng chung cho widget và `/assistant`) chỉ đặt `botInput = ''` ở nhánh thành
 * công, tức là sau khi luồng SSE đã đóng.
 *
 * Hợp đồng sau sửa, kiểm trên cả hai bề mặt với yêu cầu chat bị GIỮ (chưa trả lời):
 *   - câu hỏi vào hội thoại → ô trống ngay, trong lúc chờ;
 *   - gửi hỏng (mất mạng, 500, 429) → câu hỏi về lại ô; 400 từ chối → bản nháp về lại ô;
 *   - gửi lần hai trong lúc chờ (Enter) → không có POST thứ hai, không báo lỗi "nhập câu hỏi";
 *   - câu hỏi bị từ chối ngay ở trình duyệt (rỗng, quá dài) → ô giữ nguyên chữ;
 *   - huỷ giữa chừng (tạo cuộc mới) → ô vẫn trống, câu hỏi ở lại cuộc cũ;
 *   - "Thử lại" khi ô đang có bản nháp khác → bản nháp không bị xoá, cũng không bị đè.
 */
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test, { type TestContext } from 'node:test'
import * as Vue from 'vue'

import { click, fire, input } from './_sfc-mount.ts'
import {
  alerts, answer, bubbles, button, byId, chatServer, content, dropped, findAll, HOLD, json, launcher, messageText, mountChat,
  QUICK_QUESTIONS, sseStream, statuses, words, type ChatCtx, type MountOptions,
} from './_chat-widget-harness.ts'

const ASSISTANT = fileURLToPath(new URL('../app/pages/assistant.vue', import.meta.url))

/** The transcript of either surface (widget bubbles are `max-w-[80%]`, /assistant's `max-w-[85%]`). */
const said = (ctx: ChatCtx) => findAll(ctx.widget.root, el => typeof el.props.class === 'string' && /max-w-\[8[05]%\]/.test(el.props.class))
  .map(bubble => ({ who: /justify-end/.test(String(bubble.parent?.props.class)) ? 'user' : 'bot', text: messageText(bubble) }))

type Surface = {
  name: string
  open: (t: TestContext) => Promise<ChatCtx>
  box: (ctx: ChatCtx) => ReturnType<typeof byId>
  form: (ctx: ChatCtx) => ReturnType<typeof byId>
}

const formHolding = (ctx: ChatCtx, id: string) => findAll(ctx.widget.root, el => el.tag === 'form' && findAll(el, i => i.props.id === id).length > 0)[0]

const SURFACES: Surface[] = [
  {
    name: 'widget',
    async open(t) {
      const ctx = await mountChat(t)
      await ctx.settle()
      await click(launcher(ctx.widget)!)
      await ctx.settle()
      return ctx
    },
    box: ctx => byId(ctx.widget, 'public-chatbot-input'),
    form: ctx => formHolding(ctx, 'public-chatbot-input'),
  },
  {
    name: '/assistant',
    async open(t) {
      const options: MountOptions = { file: ASSISTANT, path: '/assistant', auto: { watch: Vue.watch, useHead: () => {} } }
      const ctx = await mountChat(t, chatServer(), options)
      await ctx.settle()
      // The page sizes its textarea through `style.height` (autoGrow / resetInputHeight); the
      // mini DOM has no style object, so give the one element a recorder (not in `html()`).
      Object.defineProperty(byId(ctx.widget, 'tro-ly-input')!, 'style', { value: {}, enumerable: false, configurable: true, writable: true })
      return ctx
    },
    box: ctx => byId(ctx.widget, 'tro-ly-input'),
    form: ctx => formHolding(ctx, 'tro-ly-input'),
  },
]

const chatPosts = (ctx: ChatCtx) => ctx.calls.filter(call => call.method === 'POST' && call.url.pathname === '/api/public/chatbot')
const boxValue = (surface: Surface, ctx: ChatCtx) => surface.box(ctx)!.model?.value

async function ask(surface: Surface, ctx: ChatCtx, question: string) {
  await input(surface.box(ctx)!, question)
  await fire(surface.form(ctx)!, 'submit')
  await ctx.settle()
}

/** Hold the next chat request; `release()` hands back a stream the test writes into. */
function holdChat(ctx: ChatCtx) {
  ctx.server.state.chat.push(() => HOLD)
  return {
    release() {
      const call = ctx.server.state.held.shift()
      assert.ok(call, 'no chat request was sent')
      const stream = sseStream(call.signal)
      call.respond(stream.response)
      return stream
    },
  }
}

for (const surface of SURFACES) {
  test(`${surface.name}: the box empties as the question is sent, while the answer is still on its way`, async (t) => {
    const ctx = await surface.open(t)
    const held = holdChat(ctx)
    await ask(surface, ctx, 'Thủ tục xoá án tích?')
    assert.equal(chatPosts(ctx).length, 1, 'the question went out')
    assert.ok(statuses(ctx.widget).some(text => text.includes('Trợ lý đang soạn câu trả lời')), 'the answer is still awaited')
    assert.equal(boxValue(surface, ctx), '', 'the sent question is still in the box while the bot answers')
    assert.deepEqual(said(ctx), [{ who: 'user', text: 'Thủ tục xoá án tích?' }])

    const stream = held.release()
    stream.push(content('Theo Điều 70…'))
    await ctx.settle()
    assert.equal(boxValue(surface, ctx), '', 'mid-stream')
    stream.done()
    await ctx.settle()
    assert.equal(boxValue(surface, ctx), '')
    assert.deepEqual(said(ctx).map(m => m.text), ['Thủ tục xoá án tích?', 'Theo Điều 70…'])
  })

  test(`${surface.name}: a second Enter while waiting sends nothing more and says nothing`, async (t) => {
    const ctx = await surface.open(t)
    const held = holdChat(ctx)
    await ask(surface, ctx, 'Câu một')
    await fire(surface.form(ctx)!, 'submit')
    await ctx.settle()
    await fire(surface.form(ctx)!, 'submit')
    await ctx.settle()
    assert.equal(chatPosts(ctx).length, 1, 'a double send went out')
    assert.deepEqual(alerts(ctx.widget), [], 'the empty box was reported as an error')
    assert.deepEqual(said(ctx), [{ who: 'user', text: 'Câu một' }])
    const stream = held.release()
    stream.push(content('Trả lời.'))
    stream.done()
    await ctx.settle()
    assert.equal(chatPosts(ctx).length, 1)
  })

  const failures: Array<{ label: string, reply: () => Response | Error, kept: boolean }> = [
    { label: 'a dropped connection', reply: () => dropped(), kept: true },
    { label: 'a 500', reply: () => json({ statusCode: 500, message: 'Lỗi máy chủ' }, 500), kept: true },
    { label: 'a 429', reply: () => json({ statusCode: 429, message: 'Bạn gửi quá nhiều yêu cầu. Vui lòng thử lại sau.' }, 429), kept: true },
    { label: 'a 400 refusal of the question itself', reply: () => json({ statusCode: 400, message: 'Câu hỏi không hợp lệ.', data: { reason: 'invalid_input' } }, 400), kept: false },
  ]
  for (const failure of failures) {
    test(`${surface.name}: ${failure.label} puts the question back in the box`, async (t) => {
      const ctx = await surface.open(t)
      ctx.server.state.chat.push(failure.reply)
      await ask(surface, ctx, 'Câu bị lỗi')
      assert.equal(boxValue(surface, ctx), 'Câu bị lỗi')
      assert.equal(said(ctx).length, failure.kept ? 1 : 0, 'the transcript keeps the failed question only when it can be retried')
    })
  }

  test(`${surface.name}: what the browser refuses before sending stays in the box`, async (t) => {
    const ctx = await surface.open(t)
    await ask(surface, ctx, 'a'.repeat(2001))
    assert.equal(boxValue(surface, ctx), 'a'.repeat(2001))
    assert.equal(chatPosts(ctx).length, 0)
  })
}

test('widget: a quick question leaves the box empty while it is answered', async (t) => {
  const surface = SURFACES[0]!
  const ctx = await surface.open(t)
  const held = holdChat(ctx)
  await click(button(ctx.widget, QUICK_QUESTIONS[0]!.question))
  await ctx.settle()
  assert.equal(chatPosts(ctx).length, 1)
  assert.equal(boxValue(surface, ctx), '')
  const stream = held.release()
  stream.done()
  await ctx.settle()
})

test('widget: a new conversation mid-wait cancels the send; the box stays empty and the question stays where it was asked', async (t) => {
  const surface = SURFACES[0]!
  const ctx = await surface.open(t)
  holdChat(ctx)
  await ask(surface, ctx, 'Câu ở cuộc A')
  assert.equal(boxValue(surface, ctx), '')
  await click(findAll(ctx.widget.root, el => el.tag === 'button' && el.props['aria-label'] === 'Danh sách cuộc trò chuyện')[0]!)
  await ctx.settle()
  await click(button(ctx.widget, 'Tạo mới'))
  await ctx.settle()
  assert.equal(chatPosts(ctx)[0]!.signal?.aborted, true)
  assert.equal(boxValue(surface, ctx), '')
  assert.deepEqual(alerts(ctx.widget), [])
  const saved = JSON.parse(ctx.local.getItem('cdkt_sessions_v1')!) as { sessions: Array<{ messages: Array<{ text: string }> }> }
  assert.deepEqual(saved.sessions.map(s => s.messages.map(m => m.text)), [[], ['Câu ở cuộc A']])
})

test('widget: "Thử lại" with another draft in the box keeps that draft, answered or failed', async (t) => {
  const surface = SURFACES[0]!
  for (const second of [answer('Đã nhận.'), () => dropped()]) {
    const ctx = await surface.open(t)
    ctx.server.state.chat.push(() => dropped(), second)
    await ask(surface, ctx, 'Câu gốc')
    await input(surface.box(ctx)!, 'Câu khác đang soạn')
    await ctx.settle()
    const retry = findAll(bubbles(ctx.widget)[0]!, el => el.tag === 'button' && words(el) === 'Thử lại')[0]!
    await click(retry)
    await ctx.settle()
    assert.equal(chatPosts(ctx).at(-1)!.body && (chatPosts(ctx).at(-1)!.body as { messages: Array<{ text: string }> }).messages.at(-1)!.text, 'Câu gốc')
    assert.equal(boxValue(surface, ctx), 'Câu khác đang soạn')
    ctx.close()
  }
})
