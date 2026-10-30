/**
 * FINDING-C2, the conversation title, RUN on the chat widget harness (tests/_chat-widget-harness.ts):
 * once the server refuses words W (moderation_blocked, or a 400 that rejects the question), W —
 * cut as a title is cut (`maxTitleChars`, 40) — is never the conversation's title: not on screen,
 * not in any save made after the refusal arrived, not after a reload.
 *
 * The title is set from the first question as it is sent, before the server judges it. A refused
 * question leaves the conversation; other copies of the same words may stay — a failed send
 * (429, no connection: unsaved, beside "Thử lại"), a copy cancelled before its first word (saved,
 * FINDING-C3), an answered one. Three ways in were found in turn: refused directly (round 1),
 * through "Thử lại" (verifier F1, round 2), by pressing Enter again on what a failure put back in
 * the input (verifier F5, round 3). One cell per way here; tests/chat-widget-behavior.test.ts holds
 * the direct and "Thử lại" ones.
 *
 * KNOWN, not covered (see docs/decisions/refactor-large-files.md): while the question waits, its
 * words are saved as the title (F2) — a reload in that window, or a second tab that loaded the
 * store then and saves later, keeps them.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { click, fire, input } from './_sfc-mount.ts'
import {
  answer, bubbles, button, buttonsWith, byLabel, chatServer, dropped, findAll, HOLD, isOpen, json, launcher, mainInput,
  openWidget, parsedStorage, QUICK_QUESTIONS, sendForm, transcript, words, type ChatCtx, type NetCall,
} from './_chat-widget-harness.ts'

const TITLE_CHARS = 40
const DEFAULT_TITLE = 'Cuộc trò chuyện mới'
const W = 'câu vi phạm'
const LONG_W = `${W} ${'kéo dài thêm nữa '.repeat(6)}`.trim()
const asTitle = (text: string) => text.normalize('NFKC').trim().slice(0, TITLE_CHARS)

const RATE_LIMITED = () => json({ statusCode: 429, message: 'Bạn gửi quá nhiều yêu cầu. Vui lòng thử lại sau.' }, 429)
const REFUSED = () => answer('Nội dung không phù hợp.', { kind: 'moderation_blocked', sources: [] })
const TOO_LONG = () => json({ statusCode: 400, message: 'Câu hỏi không được vượt quá 5 ký tự. Vui lòng rút gọn rồi gửi lại.', data: { reason: 'input_too_long', maxChars: 5 } }, 400)
const FAILURES = [['429', RATE_LIMITED], ['no connection', () => dropped()]] as const
const REFUSALS = [['moderation', REFUSED], ['400', TOO_LONG]] as const

const historyButton = (ctx: ChatCtx) => byLabel(ctx.widget, 'Danh sách cuộc trò chuyện')
const retryIn = (bubble: Parameters<typeof words>[0]) => findAll(bubble, el => el.tag === 'button' && words(el) === 'Thử lại')[0]!
/** The titles the conversation list shows (each row's delete button is labelled "Xóa <title>"). */
const listTitles = (ctx: ChatCtx) => findAll(ctx.widget.root, el => typeof el.props['aria-label'] === 'string' && el.props['aria-label'].startsWith('Xóa ') && el.props['aria-label'] !== 'Xóa lịch sử')
  .map(el => String(el.props['aria-label']).slice(4))
const storedTitles = (ctx: ChatCtx) => parsedStorage(ctx)?.sessions.map(s => s.title) ?? []

async function openDialog(ctx: ChatCtx) {
  await click(launcher(ctx.widget)!)
  await ctx.settle()
  assert.equal(isOpen(ctx.widget), true)
}
async function ask(ctx: ChatCtx, question: string) {
  await input(mainInput(ctx.widget), question)
  await fire(sendForm(ctx.widget), 'submit')
  await ctx.settle()
}
/** Enter again on what is in the input (a failure puts the question back there). */
async function enterAgain(ctx: ChatCtx) {
  await fire(sendForm(ctx.widget), 'submit')
  await ctx.settle()
}
async function pick(ctx: ChatCtx, title: string) {
  await click(historyButton(ctx))
  await ctx.settle()
  await click(button(ctx.widget, title))
  await ctx.settle()
}
/** Queue `refusal` as the next chat answer; `watch.saves` gets every save from the moment it is answered. */
function refuseNext(ctx: ChatCtx, refusal: () => Response | ((call: NetCall) => Response)) {
  const watch = { answered: false, saves: [] as string[] }
  const setItem = ctx.local.setItem
  ctx.local.setItem = (key: string, value: string) => { if (watch.answered) watch.saves.push(String(value)); setItem(key, value) }
  const reply = refusal()
  ctx.server.state.chat.push((call) => {
    watch.answered = true
    return typeof reply === 'function' ? reply(call) : reply
  })
  return watch
}

/**
 * `refused` is no title anywhere: the list, the store, every save after the refusal arrived, and
 * after a reload. Closes `ctx`; returns the titles after the reload.
 */
async function assertNeverTitled(t: Parameters<typeof openWidget>[0], ctx: ChatCtx, watch: { answered: boolean, saves: string[] }, refused: string) {
  const bad = asTitle(refused)
  assert.equal(watch.answered, true, 'the refusal was answered')
  assert.ok(watch.saves.length > 0, 'the refusal was saved')
  for (const save of watch.saves) {
    const titles = (JSON.parse(save) as { sessions: Array<{ title: string }> }).sessions.map(s => s.title)
    assert.ok(!titles.includes(bad), `a save after the refusal carries it as a title: ${JSON.stringify(titles)}`)
  }
  assert.ok(!storedTitles(ctx).includes(bad), `stored as a title: ${JSON.stringify(storedTitles(ctx))}`)
  await click(historyButton(ctx))
  await ctx.settle()
  assert.ok(!listTitles(ctx).includes(bad), `listed as a title: ${JSON.stringify(listTitles(ctx))}`)
  const saved = ctx.local.getItem('cdkt_sessions_v1')!
  ctx.close()
  const reloaded = await openWidget(t, chatServer(), { local: { cdkt_sessions_v1: saved } })
  await openDialog(reloaded)
  await click(historyButton(reloaded))
  await reloaded.settle()
  const after = listTitles(reloaded)
  assert.ok(!after.includes(bad), `a title after a reload: ${JSON.stringify(after)}`)
  reloaded.close()
  return after
}

// ─── Enter again (verifier F5) ───────────────────────────────────────────────

for (const [failure, fail] of FAILURES) {
  for (const [refusal, refuse] of REFUSALS) {
    test(`Enter again after a ${failure} failure, refused (${refusal}): the words are no title; the failed copy keeps "Thử lại"`, async (t) => {
      const ctx = await openWidget(t)
      await openDialog(ctx)
      ctx.server.state.chat.push(fail)
      await ask(ctx, W)
      assert.equal(mainInput(ctx.widget).model?.value, W, 'the failure put the words back in the input')
      const watch = refuseNext(ctx, refuse)
      await enterAgain(ctx)
      // Accepted: the failed copy (same words, never judged by the server) stays with "Thử lại".
      assert.deepEqual(transcript(ctx.widget).filter(m => m.who === 'user').map(m => m.text), [W])
      assert.equal(buttonsWith(ctx.widget, 'Thử lại').length, 1)
      assert.deepEqual(await assertNeverTitled(t, ctx, watch, W), [DEFAULT_TITLE])
    })
  }
}

test('two failed copies of the same words, "Thử lại" on the second refused: no title; the first copy keeps "Thử lại"', async (t) => {
  const ctx = await openWidget(t)
  await openDialog(ctx)
  ctx.server.state.chat.push(() => dropped(), RATE_LIMITED)
  await ask(ctx, W)
  await enterAgain(ctx)
  assert.equal(buttonsWith(ctx.widget, 'Thử lại').length, 2)
  const watch = refuseNext(ctx, REFUSED)
  await click(retryIn(bubbles(ctx.widget)[1]!))
  await ctx.settle()
  assert.equal(buttonsWith(ctx.widget, 'Thử lại').length, 1)
  assert.deepEqual(await assertNeverTitled(t, ctx, watch, W), [DEFAULT_TITLE])
})

test('a quick question that failed, chosen again and refused: the same path, no title', async (t) => {
  const ctx = await openWidget(t)
  await openDialog(ctx)
  const chip = QUICK_QUESTIONS[0]!.question
  ctx.server.state.chat.push(RATE_LIMITED)
  await click(button(ctx.widget, chip))
  await ctx.settle()
  const watch = refuseNext(ctx, REFUSED)
  await click(button(ctx.widget, chip))
  await ctx.settle()
  assert.deepEqual(await assertNeverTitled(t, ctx, watch, chip), [DEFAULT_TITLE])
})

// ─── Copies of the words that the conversation keeps ─────────────────────────

test('a question cancelled before its first word, then sent again with Enter and refused: no title (the cancelled copy stays, saved)', async (t) => {
  const ctx = await openWidget(t)
  await openDialog(ctx)
  ctx.server.state.chat.push(answer('Trả lời A.'))
  await ask(ctx, 'Câu A')
  await pick(ctx, 'Tạo mới')
  ctx.server.state.chat.push(() => HOLD)
  await ask(ctx, W)
  await pick(ctx, 'Câu A') // cancels W before its first word (FINDING-C3)
  await pick(ctx, W)
  assert.equal(mainInput(ctx.widget).model?.value, W, 'the words are still in the input')
  const watch = refuseNext(ctx, REFUSED)
  await enterAgain(ctx)
  assert.deepEqual(transcript(ctx.widget).filter(m => m.who === 'user').map(m => m.text), [W], 'the cancelled copy stays (C3 trade-off)')
  assert.deepEqual(await assertNeverTitled(t, ctx, watch, W), [DEFAULT_TITLE, 'Câu A'])
})

test('words answered earlier, then the same words refused: no title — the next question in other words gives it', async (t) => {
  for (const withOther of [false, true]) {
    const ctx = await openWidget(t)
    await openDialog(ctx)
    ctx.server.state.chat.push(answer('Được.'))
    await ask(ctx, W)
    if (withOther) {
      ctx.server.state.chat.push(answer('Cũng được.'))
      await ask(ctx, 'Câu khác')
    }
    const watch = refuseNext(ctx, REFUSED)
    await ask(ctx, W)
    assert.deepEqual(await assertNeverTitled(t, ctx, watch, W), [withOther ? 'Câu khác' : DEFAULT_TITLE])
  }
})

// ─── Which question gives the title ──────────────────────────────────────────

test('the FIRST question left in other words gives the title, not the last', async (t) => {
  const ctx = await openWidget(t)
  await openDialog(ctx)
  ctx.server.state.chat.push(RATE_LIMITED, answer('Hai.'), answer('Ba.'))
  await ask(ctx, W)
  await ask(ctx, 'Câu hai')
  await ask(ctx, 'Câu ba')
  const watch = refuseNext(ctx, REFUSED)
  await click(retryIn(bubbles(ctx.widget)[0]!))
  await ctx.settle()
  assert.deepEqual(await assertNeverTitled(t, ctx, watch, W), ['Câu hai'])
})

test('refused words longer than a title, with another question left: neither the words nor their first 40 characters are the title', async (t) => {
  for (const refuse of [REFUSED, TOO_LONG]) {
    const ctx = await openWidget(t)
    await openDialog(ctx)
    ctx.server.state.chat.push(RATE_LIMITED, answer('Hai.'))
    await ask(ctx, LONG_W)
    assert.equal(storedTitles(ctx)[0], asTitle(LONG_W), 'the failed send titled it with the cut words')
    await ask(ctx, 'Câu hai')
    const watch = refuseNext(ctx, refuse)
    await click(retryIn(bubbles(ctx.widget)[0]!))
    await ctx.settle()
    assert.deepEqual(await assertNeverTitled(t, ctx, watch, LONG_W), ['Câu hai'])
  }
})

test('a long question left gives the title cut to 40 characters, like any auto title', async (t) => {
  const longOther = `Câu hai ${'cũng khá là dài '.repeat(6)}`.trim()
  const ctx = await openWidget(t)
  await openDialog(ctx)
  ctx.server.state.chat.push(RATE_LIMITED, () => dropped())
  await ask(ctx, W)
  await ask(ctx, longOther)
  const watch = refuseNext(ctx, REFUSED)
  await click(retryIn(bubbles(ctx.widget)[0]!))
  await ctx.settle()
  const title = storedTitles(ctx)[0]!
  assert.equal(title, asTitle(longOther))
  assert.ok(title.length <= TITLE_CHARS)
  await assertNeverTitled(t, ctx, watch, W)
})

test('a question in other words that failed stays the title when the next one is refused', async (t) => {
  const ctx = await openWidget(t)
  await openDialog(ctx)
  ctx.server.state.chat.push(() => dropped())
  await ask(ctx, 'Câu một')
  const watch = refuseNext(ctx, REFUSED)
  await ask(ctx, W)
  assert.deepEqual(await assertNeverTitled(t, ctx, watch, W), ['Câu một'])
})

// ─── Leaving and coming back, clearing, deleting ─────────────────────────────

test('failed, "Tạo mới", back, "Thử lại" refused: the right conversation loses the title, the other is untouched', async (t) => {
  const ctx = await openWidget(t)
  await openDialog(ctx)
  ctx.server.state.chat.push(RATE_LIMITED)
  await ask(ctx, W)
  await pick(ctx, 'Tạo mới')
  await pick(ctx, W)
  const watch = refuseNext(ctx, REFUSED)
  await click(retryIn(bubbles(ctx.widget)[0]!))
  await ctx.settle()
  assert.deepEqual([...await assertNeverTitled(t, ctx, watch, W)].sort(), [DEFAULT_TITLE, DEFAULT_TITLE])
})

test('clearing or deleting the conversation while the words wait: the request is cancelled, no refusal is processed, no title is left', async (t) => {
  for (const how of ['clear', 'delete'] as const) {
    const ctx = await openWidget(t)
    await openDialog(ctx)
    ctx.server.state.chat.push(answer('Trả lời A.'))
    await ask(ctx, 'Câu A')
    await pick(ctx, 'Tạo mới')
    ctx.server.state.chat.push(() => HOLD)
    await ask(ctx, W)
    const call = ctx.server.state.held.shift()!
    if (how === 'clear') await click(byLabel(ctx.widget, 'Xóa lịch sử'))
    else {
      await click(historyButton(ctx))
      await ctx.settle()
      await click(byLabel(ctx.widget, `Xóa ${W}`))
    }
    await ctx.settle()
    assert.equal(call.signal?.aborted, true)
    assert.deepEqual(storedTitles(ctx), how === 'clear' ? [DEFAULT_TITLE, 'Câu A'] : ['Câu A'])
    ctx.close()
  }
})
