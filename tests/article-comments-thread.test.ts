/**
 * The public comment thread (`app/components/ArticleComments.vue`) — behaviour, through
 * its own controls.
 *
 * Wave 3 task 4.2 splits the 732-line component. Written BEFORE the split and run the same
 * way on both versions: the REAL component mounted on a minimal DOM with real ofetch over a
 * fake comments API (tests/_article-comments-harness.ts). Every action is a click or a typed
 * value on the rendered control, so a split that forgets to wire a model or an emit fails
 * here exactly as a dead control would.
 *
 * Pinned (green on the base e444621 and after the split):
 *   - mount: the announced skeleton, ONE read of `GET /api/public/comments/<slug>?page=1`
 *     after the reader identity, top-level comments with their one level of replies;
 *   - a failed read is the `role="alert"` sentence, never the empty-thread sentence, and
 *     "thử lại" re-reads; `comments_enabled` off hides the whole section;
 *   - signed out: the Google sign-in prompt, no compose form, no "Trả lời";
 *   - posting: the optimistic entry while sending, the exact POST body (article: only
 *     `articleSlug`; media: only `mediaSlug`), the box cleared only after the write landed,
 *     the draft key removed, the thread re-read;
 *   - the moderation checkpoint 2.5 s / 6 s / 11 s / 18 s after a post: a comment the worker
 *     hid is taken off the page with the generic revocation notice (`role="alert"`, ✕ closes);
 *   - failures: the server's sentence (429 rate limit, 403 ban) on the failed entry and under
 *     the box, the text kept, "Thử lại" re-sends, "Bỏ qua" drops; a 401 saves the draft
 *     BEFORE dropping the identity and swaps the form for the sign-in prompt with the reason;
 *     the draft comes back after signing in, once;
 *   - reply, delete (asks first; refusal sends nothing), copy link, the notification deep
 *     link (`?comments=<page>#comment-<id>`: page read first, scroll, highlight for 3 s).
 *
 * FINDING tests (RED on the base — each says why; fixed with the split):
 *   - FINDING-C1 the pager label printed the raw i18n template: "Trang {current} / {total} 1 / 2";
 *   - FINDING-C2 the moderation checkpoint kept polling the API after the reader left the page;
 *   - FINDING-C3 "Thử lại" on a failed entry while another comment was sending dropped the
 *     failed text for good (taken off the list, then wiped with the box when the other landed);
 *   - FINDING-C4 a video's saved draft was restored into the article with the same slug (one
 *     sessionStorage key for both kinds, although the two slug namespaces overlap).
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { click, findAll, fire, input, textOf } from './_sfc-mount.ts'
import {
  HOLD, adminReply, alertTexts, button, buttons, comment, commentEl, commentsServer, composeBox, dropped, forms, h3Error,
  hasComment, json, mountThread, openThread, pendingItems, replyBox, section, sent, skeleton, vi, type NetCall,
} from './_article-comments-harness.ts'

const GET_P1 = 'GET /api/public/comments/bai-viet?page=1'
const RATE_LIMIT = 'Bạn đã gửi quá nhiều bình luận. Vui lòng thử lại sau ít phút.'
const BANNED = 'Tài khoản của bạn đã bị hạn chế bình luận trên cổng thông tin.'
const DRAFT_KEY = 'cdkt:comment-draft:bai-viet'

function seeded() {
  const server = commentsServer()
  server.state.comments = [
    { ...comment(1), replies: [adminReply(2, 1)] },
    comment(3, { canDelete: true, body: 'Dòng một\nDòng hai' }),
  ]
  return server
}

/**
 * Type into the compose box and submit. The submit is NOT awaited: `fire` waits for the
 * handler's promise, and a held request would never let it finish — `settle()` lets an
 * answered one run to the end.
 */
const submitCompose = async (ctx: Awaited<ReturnType<typeof openThread>>, text: string) => {
  await input(composeBox(ctx.thread)!, text)
  await ctx.settle()
  void fire(forms(ctx.thread).at(-1)!, 'submit')
  await ctx.settle()
}

describe('reading the thread', () => {
  it('shows the announced skeleton, then reads the thread once, after the identity', async (t) => {
    const server = seeded()
    let held: NetCall | null = null
    server.state.override = call => { if (!held && call.method === 'GET') { held = call; return HOLD } }
    const ctx = await mountThread(t, server)
    await ctx.settle()

    const busy = skeleton(ctx.thread)
    assert.ok(busy, 'no role="status" aria-busy skeleton while loading')
    assert.match(textOf(busy), /Đang tải bình luận/)
    assert.equal(ctx.reader.loads, 1, 'the identity is loaded before the thread')
    assert.deepEqual(sent(ctx.calls), [GET_P1])

    server.answer(held!)
    await ctx.settle()
    assert.equal(skeleton(ctx.thread), null)
    assert.match(textOf(section(ctx.thread)!), /Bình luận \(2\)/)
    assert.match(textOf(commentEl(ctx.thread, 1)), /Bạn đọc 1/)
    assert.match(textOf(commentEl(ctx.thread, 2)), /Ban quản trị.*Cảm ơn bạn đã theo dõi\./)
    // Line breaks a citizen typed survive as text (whitespace-pre-line), never as markup.
    const body3 = findAll(commentEl(ctx.thread, 3), el => el.tag === 'p')[0]!
    assert.equal(textOf(body3), 'Dòng một Dòng hai')
    assert.match(String(body3.props.class), /whitespace-pre-line break-words/)
    assert.deepEqual(sent(ctx.calls), [GET_P1], 'one read, no more')
  })

  it('a failed read is a persistent alert, not an empty thread; "thử lại" re-reads', async (t) => {
    const server = seeded()
    server.state.override = call => (call.method === 'GET' ? h3Error(503, 'Dịch vụ tạm thời gián đoạn.') : undefined)
    const ctx = await openThread(t, server)
    assert.deepEqual(alertTexts(ctx.thread), ['Không thể tải bình luận. Vui lòng thử lại.'])
    assert.doesNotMatch(textOf(ctx.thread.root), /Chưa có bình luận/)
    const before = ctx.calls.length
    server.state.override = () => undefined
    await click(button(ctx.thread, 'thử lại'))
    await ctx.settle()
    assert.deepEqual(sent(ctx.calls, before), [GET_P1])
    assert.deepEqual(alertTexts(ctx.thread), [])
    assert.ok(hasComment(ctx.thread, 1))
  })

  it('a dropped connection is the same alert', async (t) => {
    const server = seeded()
    server.state.override = call => (call.method === 'GET' ? dropped() : undefined)
    const ctx = await openThread(t, server)
    assert.deepEqual(alertTexts(ctx.thread), ['Không thể tải bình luận. Vui lòng thử lại.'])
  })

  it('comments switched off for the item: the whole section goes away, even for a signed-in reader', async (t) => {
    const server = seeded()
    server.state.enabled = false
    const ctx = await openThread(t, server, { signedIn: true })
    assert.equal(section(ctx.thread), null)
    assert.equal(composeBox(ctx.thread), null)
  })

  it('an empty open thread, signed in: the empty sentence and the compose form with its counter', async (t) => {
    const ctx = await openThread(t, commentsServer(), { signedIn: true })
    assert.match(textOf(ctx.thread.root), new RegExp(vi('no_comments_yet')))
    assert.ok(composeBox(ctx.thread))
    assert.match(textOf(forms(ctx.thread)[0]!), /0 \/ 2000 ký tự/)
    assert.equal(button(ctx.thread, 'Gửi bình luận').props.disabled, true, 'nothing typed, nothing to send')
  })

  it('signed out: the sign-in prompt instead of the form, and no reply buttons', async (t) => {
    const ctx = await openThread(t, seeded())
    assert.equal(forms(ctx.thread).length, 0)
    assert.equal(buttons(ctx.thread, 'Trả lời').length, 0)
    assert.match(textOf(ctx.thread.root), new RegExp(vi('c_google_login_desc')))
    await click(button(ctx.thread, 'Đăng nhập bằng Google'))
    assert.equal(ctx.reader.signIns, 1)
    // Delete is offered only where the server said this reader may (canDelete).
    assert.equal(buttons(commentEl(ctx.thread, 1), 'Xóa').length, 0)
    assert.equal(buttons(commentEl(ctx.thread, 3), 'Xóa').length, 1)
    assert.equal(buttons(commentEl(ctx.thread, 2), 'Xóa').length, 0)
  })
})

describe('posting', () => {
  it('shows the optimistic entry while sending, posts the exact body, clears only after it landed', async (t) => {
    const server = seeded()
    let held: NetCall | null = null
    server.state.override = call => { if (call.method === 'POST') { held = call; return HOLD } }
    const ctx = await openThread(t, server, { signedIn: true })
    const from = ctx.calls.length
    await submitCompose(ctx, '  Câu hỏi của tôi  ')

    const pending = pendingItems(ctx.thread)
    assert.equal(pending.length, 1)
    assert.equal(textOf(pending[0]!), 'Đang gửi...Câu hỏi của tôi', 'trimmed, dimmed, no retry while sending')
    assert.equal(button(ctx.thread, 'Đang gửi...').props.disabled, true)
    assert.equal(composeBox(ctx.thread)!.model!.value, '  Câu hỏi của tôi  ', 'the box keeps the text while the write is in flight')

    server.state.override = () => undefined
    server.answer(held!)
    await ctx.settle()
    assert.deepEqual(sent(ctx.calls, from), [
      { wire: 'POST /api/public/comments', body: { articleSlug: 'bai-viet', parentId: null, body: '  Câu hỏi của tôi  ' } },
      GET_P1,
    ])
    assert.equal(pendingItems(ctx.thread).length, 0)
    assert.equal(composeBox(ctx.thread)!.model!.value, '')
    assert.ok(ctx.storageLog.includes(`remove ${DRAFT_KEY}`), 'the draft key is cleared after a successful post')
    assert.ok(hasComment(ctx.thread, 900))
  })

  it('the moderation checkpoint takes a hidden comment off the page with the generic notice', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const server = seeded()
    const ctx = await openThread(t, server, { signedIn: true })
    await submitCompose(ctx, 'Nội dung sẽ bị ẩn')
    assert.ok(hasComment(ctx.thread, 900))
    const from = ctx.calls.length

    server.state.hidden.add(900)
    t.mock.timers.tick(2500)
    await ctx.settle()
    assert.deepEqual(sent(ctx.calls, from), ['GET /api/public/comments/checkpoint?ids=900'])
    assert.equal(hasComment(ctx.thread, 900), false)
    assert.match(textOf(section(ctx.thread)!), /Bình luận \(2\)/)
    const notice = vi('c_revoked_template').replace('{reason}', vi('c_revoked_default'))
    assert.deepEqual(alertTexts(ctx.thread), [`${vi('c_revoked_label')} ${notice}✕`])

    t.mock.timers.tick(20_000)
    await ctx.settle()
    assert.equal(ctx.calls.length, from + 1, 'once gone, the later checkpoints send nothing')

    await click(findAll(ctx.thread.root, el => el.tag === 'button' && el.props.title === vi('c_close_notice'))[0]!)
    await ctx.settle()
    assert.deepEqual(alertTexts(ctx.thread), [])
  })

  it('a reply the worker hides is taken out of its parent', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const server = seeded()
    const ctx = await openThread(t, server, { signedIn: true })
    await click(buttons(commentEl(ctx.thread, 1), 'Trả lời')[0]!)
    await ctx.settle()
    await input(replyBox(ctx.thread)!, 'Phản hồi sẽ bị ẩn')
    await ctx.settle()
    await fire(forms(ctx.thread)[0]!, 'submit')
    await ctx.settle()
    assert.ok(hasComment(ctx.thread, 900))
    server.state.hidden.add(900)
    t.mock.timers.tick(2500)
    await ctx.settle()
    assert.equal(hasComment(ctx.thread, 900), false)
    assert.ok(hasComment(ctx.thread, 2), 'the other reply stays')
  })

  it('a comment the worker keeps is checked four times, then left alone', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const ctx = await openThread(t, seeded(), { signedIn: true })
    await submitCompose(ctx, 'Nội dung hợp lệ')
    const from = ctx.calls.length
    for (const step of [2500, 3500, 5000, 7000, 30_000]) {
      t.mock.timers.tick(step)
      await ctx.settle()
    }
    assert.deepEqual(sent(ctx.calls, from), Array(4).fill('GET /api/public/comments/checkpoint?ids=900'))
    assert.ok(hasComment(ctx.thread, 900))
    assert.deepEqual(alertTexts(ctx.thread), [])
  })

  it('FINDING-C2: leaving the page stops the moderation checkpoint', async (t) => {
    // RED on the base: four `window.setTimeout`s were scheduled per post and never cleared,
    // so up to four GETs left a page the reader had already closed (and wrote into its dead
    // state).
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const ctx = await openThread(t, seeded(), { signedIn: true })
    await submitCompose(ctx, 'Rời trang ngay sau khi gửi')
    const from = ctx.calls.length
    ctx.leave()
    t.mock.timers.tick(30_000)
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(sent(ctx.calls, from), [], 'a checkpoint request left the page after unmount')
  })

  it('leaving while the POST is in flight: once it lands nothing else is sent (no re-read, no checkpoint); the draft key is cleared', async (t) => {
    // RED before the follow-up fix (M03): the answer that landed after unmount still re-read
    // the thread for a page nobody was on and wrote into its dead state.
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const server = seeded()
    let held: NetCall | null = null
    server.state.override = call => { if (call.method === 'POST') { held = call; return HOLD } }
    const ctx = await openThread(t, server, { signedIn: true })
    await submitCompose(ctx, 'Gửi rồi rời trang')
    const from = ctx.calls.length
    ctx.leave()
    // A draft from an earlier lapsed session, still in this tab's storage.
    ctx.storage.set(DRAFT_KEY, 'Gửi rồi rời trang')
    server.state.override = () => undefined
    server.answer(held!)
    for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve))
    t.mock.timers.tick(30_000)
    for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(sent(ctx.calls, from), [], 'a request left the page after unmount')
    assert.equal(ctx.storage.has(DRAFT_KEY), false, 'the comment was accepted: no draft may bring it back')
  })

  it('leaving while the re-read after a post is in flight: no moderation checkpoint is scheduled', async (t) => {
    // Kills the mutant that drops `if (left) return` at the top of startModerationCheckpoint:
    // the POST landed while the page was alive, the re-read lands after it is gone.
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const server = seeded()
    const ctx = await openThread(t, server, { signedIn: true })
    let held: NetCall | null = null
    server.state.override = call => { if (call.method === 'GET' && !held) { held = call; return HOLD } }
    await submitCompose(ctx, 'Gửi, đọc lại, rời trang')
    assert.ok(held, 'the re-read after the post is in flight')
    const from = ctx.calls.length
    ctx.leave()
    server.state.override = () => undefined
    server.answer(held!)
    for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve))
    t.mock.timers.tick(30_000)
    for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(sent(ctx.calls, from), [], 'a checkpoint request left the page after unmount')
  })

  it('leaving while a DELETE is in flight: once it lands the thread is not re-read', async (t) => {
    const server = seeded()
    let held: NetCall | null = null
    server.state.override = call => { if (call.method === 'DELETE') { held = call; return HOLD } }
    const ctx = await openThread(t, server, { signedIn: true })
    void fire(buttons(commentEl(ctx.thread, 3), 'Xóa')[0]!, 'click')
    await ctx.settle()
    const from = ctx.calls.length
    ctx.leave()
    server.state.override = () => undefined
    server.answer(held!)
    for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(sent(ctx.calls, from), [], 'the thread was re-read for a page nobody is on')
  })

  it('a rate-limited post (429): the server sentence on the entry and under the box, text kept; Thử lại re-sends', async (t) => {
    const server = seeded()
    server.state.override = call => (call.method === 'POST' ? h3Error(429, RATE_LIMIT) : undefined)
    const ctx = await openThread(t, server, { signedIn: true })
    const from = ctx.calls.length
    await submitCompose(ctx, 'Gửi lại sau')
    assert.deepEqual(sent(ctx.calls, from), [{ wire: 'POST /api/public/comments', body: { articleSlug: 'bai-viet', parentId: null, body: 'Gửi lại sau' } }])
    assert.deepEqual(alertTexts(ctx.thread), [RATE_LIMIT, RATE_LIMIT])
    assert.equal(composeBox(ctx.thread)!.model!.value, 'Gửi lại sau', 'a refused write never clears what was typed')
    assert.equal(ctx.reader.forgets, 0)
    assert.equal(pendingItems(ctx.thread).length, 1)

    server.state.override = () => undefined
    await click(button(pendingItems(ctx.thread)[0]!, 'Thử lại'))
    await ctx.settle()
    assert.deepEqual(sent(ctx.calls, from + 1), [
      { wire: 'POST /api/public/comments', body: { articleSlug: 'bai-viet', parentId: null, body: 'Gửi lại sau' } },
      GET_P1,
    ])
    assert.equal(pendingItems(ctx.thread).length, 0)
    assert.ok(hasComment(ctx.thread, 900))
  })

  it('"Bỏ qua" drops a failed entry and sends nothing', async (t) => {
    const server = seeded()
    server.state.override = call => (call.method === 'POST' ? h3Error(429, RATE_LIMIT) : undefined)
    const ctx = await openThread(t, server, { signedIn: true })
    await submitCompose(ctx, 'Bỏ đi')
    const from = ctx.calls.length
    await click(button(pendingItems(ctx.thread)[0]!, 'Bỏ qua'))
    await ctx.settle()
    assert.equal(pendingItems(ctx.thread).length, 0)
    assert.deepEqual(sent(ctx.calls, from), [])
  })

  it('a banned reader (403): the sentence, the identity kept, no sign-in offered', async (t) => {
    const server = seeded()
    server.state.override = call => (call.method === 'POST' ? h3Error(403, BANNED) : undefined)
    const ctx = await openThread(t, server, { signedIn: true })
    await submitCompose(ctx, 'Không được gửi')
    assert.deepEqual(alertTexts(ctx.thread), [BANNED, BANNED])
    assert.equal(ctx.reader.forgets, 0)
    assert.ok(composeBox(ctx.thread), 'still the compose form')
    assert.equal(buttons(ctx.thread, 'Đăng nhập bằng Google').length, 0)
  })

  it('a lapsed ticket (401): draft saved BEFORE the identity drops; the prompt says why and promises the text', async (t) => {
    const server = seeded()
    const ctx = await openThread(t, server, { signedIn: true })
    server.state.ticket = false
    const forgetsAt: number[] = []
    const realForget = ctx.storageLog.length
    await input(composeBox(ctx.thread)!, 'Ba đoạn văn quan trọng')
    await ctx.settle()
    await fire(forms(ctx.thread).at(-1)!, 'submit')
    forgetsAt.push(ctx.reader.forgets)
    await ctx.settle()

    assert.ok(ctx.reader.forgets >= 1, 'the stale identity is dropped')
    assert.equal(ctx.storage.get(DRAFT_KEY), 'Ba đoạn văn quan trọng')
    assert.equal(ctx.storageLog[realForget], `set ${DRAFT_KEY}`)
    assert.equal(forms(ctx.thread).length, 0, 'the form is swapped for the sign-in prompt')
    const alerts = alertTexts(ctx.thread)
    assert.ok(alerts.some(a => a.startsWith(vi('c_session_lapsed')) && a.includes(vi('c_session_lapsed_keep'))), JSON.stringify(alerts))
    assert.ok(buttons(ctx.thread, 'Đăng nhập bằng Google').length === 1)
    // The failed entry stays visible with its text — nothing typed is lost on screen either.
    assert.equal(textOf(pendingItems(ctx.thread)[0]!), 'Chưa đăng nhậpBa đoạn văn quan trọngThử lạiBỏ qua')
  })

  it('the saved draft comes back once signed in, and is removed; signed out it waits', async (t) => {
    const waiting = await openThread(t, seeded(), { storage: { [DRAFT_KEY]: 'Nháp cũ' } })
    assert.equal(waiting.storage.get(DRAFT_KEY), 'Nháp cũ', 'not restored into a form that is not shown')
    waiting.close()

    const ctx = await openThread(t, seeded(), { signedIn: true, storage: { [DRAFT_KEY]: 'Nháp cũ' } })
    assert.equal(composeBox(ctx.thread)!.model!.value, 'Nháp cũ')
    assert.equal(ctx.storage.has(DRAFT_KEY), false)
  })

  it('FINDING-C3: "Thử lại" on a failed entry while another comment is sending keeps the failed text', async (t) => {
    // RED on the base: retry took the entry off the list and put its text in the box, but
    // submit() returned at once (one write already in flight) — then the in-flight write
    // landed and cleared the box. The failed comment was gone from everywhere.
    const server = seeded()
    let held: NetCall | null = null
    let posts = 0
    server.state.override = call => {
      if (call.method !== 'POST') return undefined
      posts += 1
      if (posts === 1) return h3Error(429, RATE_LIMIT)
      if (posts === 2) { held = call; return HOLD }
      return undefined
    }
    const ctx = await openThread(t, server, { signedIn: true })
    await submitCompose(ctx, 'Bình luận A')
    await submitCompose(ctx, 'Bình luận B')
    const failed = pendingItems(ctx.thread).find(li => textOf(li).includes('Bình luận A'))!
    // `fire`, not `click`: the button is disabled while sending (test below) — this proves the
    // flow itself also refuses, whatever reaches the handler.
    await fire(button(failed, 'Thử lại'), 'click')
    await ctx.settle()
    server.answer(held!)
    await ctx.settle()
    const onScreen = textOf(ctx.thread.root)
    const postedA = ctx.calls.filter(c => c.method === 'POST' && (c.body as { body: string }).body === 'Bình luận A').length
    assert.ok(onScreen.includes('Bình luận A') || postedA === 2, 'comment A vanished: neither on screen nor sent again')
  })

  it('C3 has feedback: "Thử lại" is disabled while another comment is sending, and works once it landed', async (t) => {
    // RED before the follow-up fix: the flow refused the retry (FINDING-C3) but the button
    // still looked and acted pressable — a click that silently did nothing.
    const server = seeded()
    let held: NetCall | null = null
    let posts = 0
    server.state.override = call => {
      if (call.method !== 'POST') return undefined
      posts += 1
      if (posts === 1) return h3Error(429, RATE_LIMIT)
      if (posts === 2) { held = call; return HOLD }
      return undefined
    }
    const ctx = await openThread(t, server, { signedIn: true })
    await submitCompose(ctx, 'Bình luận A')
    const retryA = () => button(pendingItems(ctx.thread).find(li => textOf(li).includes('Bình luận A'))!, 'Thử lại')
    assert.notEqual(retryA().props.disabled, true, 'nothing in flight: retry is available')
    await submitCompose(ctx, 'Bình luận B')
    assert.equal(retryA().props.disabled, true, 'a write is in flight: retry is disabled')
    assert.match(String(retryA().props.class), /disabled:opacity-50/, 'and looks it')
    assert.notEqual(button(pendingItems(ctx.thread).find(li => textOf(li).includes('Bình luận A'))!, 'Bỏ qua').props.disabled, true, 'dismiss stays available')

    server.state.override = () => undefined
    server.answer(held!)
    await ctx.settle()
    assert.notEqual(retryA().props.disabled, true, 'B landed: retry is available again')
    const from = ctx.calls.length
    await click(retryA())
    await ctx.settle()
    assert.deepEqual(sent(ctx.calls, from), [
      { wire: 'POST /api/public/comments', body: { articleSlug: 'bai-viet', parentId: null, body: 'Bình luận A' } },
      GET_P1,
    ])
  })
})

describe('reply and delete', () => {
  it('"Trả lời" opens a box under that comment, posts with parentId, then closes; "Huỷ" closes', async (t) => {
    const server = seeded()
    const ctx = await openThread(t, server, { signedIn: true })
    await click(buttons(commentEl(ctx.thread, 3), 'Trả lời')[0]!)
    await ctx.settle()
    const reply = forms(commentEl(ctx.thread, 3))
    assert.equal(reply.length, 1, 'the reply box sits under the comment it answers')
    await click(button(reply[0]!, 'Huỷ'))
    await ctx.settle()
    assert.equal(forms(commentEl(ctx.thread, 3)).length, 0)

    await click(buttons(commentEl(ctx.thread, 3), 'Trả lời')[0]!)
    await ctx.settle()
    assert.equal(button(commentEl(ctx.thread, 3), 'Gửi trả lời').props.disabled, true)
    await input(replyBox(ctx.thread)!, 'Tôi cũng thắc mắc')
    await ctx.settle()
    const from = ctx.calls.length
    await fire(forms(commentEl(ctx.thread, 3))[0]!, 'submit')
    await ctx.settle()
    assert.deepEqual(sent(ctx.calls, from), [
      { wire: 'POST /api/public/comments', body: { articleSlug: 'bai-viet', parentId: 3, body: 'Tôi cũng thắc mắc' } },
      GET_P1,
    ])
    assert.equal(forms(commentEl(ctx.thread, 3)).length, 0, 'the reply box closes after the reply landed')
    assert.match(textOf(commentEl(ctx.thread, 3)), /Tôi cũng thắc mắc/)

    // Toggling the same comment twice closes it.
    await click(buttons(commentEl(ctx.thread, 1), 'Trả lời')[0]!)
    await ctx.settle()
    await click(buttons(commentEl(ctx.thread, 1), 'Trả lời')[0]!)
    await ctx.settle()
    assert.equal(forms(commentEl(ctx.thread, 1)).length, 0)
  })

  it('delete asks first: "no" sends nothing; "yes" deletes then re-reads', async (t) => {
    const server = seeded()
    const ctx = await openThread(t, server, { signedIn: true })
    const from = ctx.calls.length
    ctx.confirmAnswer.value = false
    await click(buttons(commentEl(ctx.thread, 3), 'Xóa')[0]!)
    await ctx.settle()
    assert.deepEqual(ctx.confirms, [vi('c_delete_confirm')])
    assert.deepEqual(sent(ctx.calls, from), [])

    ctx.confirmAnswer.value = true
    await click(buttons(commentEl(ctx.thread, 3), 'Xóa')[0]!)
    await ctx.settle()
    assert.deepEqual(sent(ctx.calls, from), ['DELETE /api/public/comments/3', GET_P1])
    assert.equal(hasComment(ctx.thread, 3), false)
  })

  it('a refused delete shows the server sentence under the box', async (t) => {
    const server = seeded()
    server.state.override = call => (call.method === 'DELETE' ? h3Error(403, 'Bạn chỉ có thể xoá bình luận của chính mình.') : undefined)
    const ctx = await openThread(t, server, { signedIn: true })
    await click(buttons(commentEl(ctx.thread, 3), 'Xóa')[0]!)
    await ctx.settle()
    assert.deepEqual(alertTexts(ctx.thread), ['Bạn chỉ có thể xoá bình luận của chính mình.'])
    assert.ok(hasComment(ctx.thread, 3))
  })
})

describe('which item the thread belongs to', () => {
  it('a media thread reads with source=media and posts mediaSlug; an article sends neither', async (t) => {
    const ctx = await openThread(t, seeded(), { slug: 'video-mot', mediaItemId: 7, signedIn: true })
    await submitCompose(ctx, 'Về video này')
    assert.deepEqual(sent(ctx.calls), [
      'GET /api/public/comments/video-mot?page=1&source=media',
      { wire: 'POST /api/public/comments', body: { mediaSlug: 'video-mot', parentId: null, body: 'Về video này' } },
      'GET /api/public/comments/video-mot?page=1&source=media',
    ])
  })

  it('FINDING-C4: a video draft does not land in the article that shares its slug', async (t) => {
    // RED on the base: the draft key was `cdkt:comment-draft:<slug>` for both kinds, and an
    // article slug and a video slug may be the same string (two tables, two namespaces).
    const server = seeded()
    const video = await openThread(t, server, { slug: 'trung-ten', mediaItemId: 7, signedIn: true })
    server.state.ticket = false
    await submitCompose(video, 'Câu hỏi về VIDEO')
    const saved = Object.fromEntries(video.storage)
    video.close()

    const article = await openThread(t, commentsServer(), { slug: 'trung-ten', signedIn: true, storage: saved })
    assert.notEqual(composeBox(article.thread)!.model!.value, 'Câu hỏi về VIDEO', 'the video draft was restored into the article')
  })
})

describe('deep links and sharing', () => {
  it('a notification link reads the asked page first, scrolls to the comment and highlights it for 3 s', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const server = seeded()
    server.state.pages[2] = [comment(45)]
    const ctx = await openThread(t, server, { hash: '#comment-45', query: { comments: '2' } })
    assert.deepEqual(sent(ctx.calls), ['GET /api/public/comments/bai-viet?page=2'])
    assert.deepEqual(ctx.scrolls, [{ id: 'comment-45', behavior: 'smooth', block: 'center' }])
    assert.match(String(commentEl(ctx.thread, 45).props.class), /ring-2/)
    t.mock.timers.tick(3000)
    await ctx.settle()
    assert.doesNotMatch(String(commentEl(ctx.thread, 45).props.class), /ring-2/)
  })

  it('a reply anchor highlights the reply; reduced motion jumps instead of gliding', async (t) => {
    const ctx = await openThread(t, seeded(), { hash: '#comment-2', reducedMotion: true })
    assert.deepEqual(ctx.scrolls, [{ id: 'comment-2', behavior: 'auto', block: 'center' }])
    assert.match(String(commentEl(ctx.thread, 2).props.class), /ring-2/)
  })

  it('a junk or stale anchor does nothing', async (t) => {
    for (const hash of ['#comment-abc', '#comment-999', '#comment-0', '#comment-1.5']) {
      const ctx = await openThread(t, seeded(), { hash })
      assert.deepEqual(ctx.scrolls, [], hash)
      ctx.close()
    }
  })

  it('copy link: the address with #comment-<id> (and ?comments= past page 1); the label flips back after 2 s', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const server = seeded()
    server.state.pages[2] = [comment(45)]
    const ctx = await openThread(t, server)
    await click(buttons(commentEl(ctx.thread, 1), 'Sao chép liên kết')[0]!)
    await ctx.settle()
    assert.deepEqual(ctx.clipboard, ['http://portal.test/news/bai-viet#comment-1'])
    assert.equal(buttons(commentEl(ctx.thread, 1), 'Đã sao chép liên kết').length, 1)
    t.mock.timers.tick(2000)
    await ctx.settle()
    assert.equal(buttons(commentEl(ctx.thread, 1), 'Đã sao chép liên kết').length, 0)

    await click(button(ctx.thread, 'Sau'))
    await ctx.settle()
    await click(buttons(commentEl(ctx.thread, 45), 'Sao chép liên kết')[0]!)
    await ctx.settle()
    assert.equal(ctx.clipboard[1], 'http://portal.test/news/bai-viet?comments=2#comment-45')

    t.mock.timers.tick(2000)
    await ctx.settle()
    ctx.clipboardAnswer.fails = true
    await click(buttons(commentEl(ctx.thread, 45), 'Sao chép liên kết')[0]!)
    await ctx.settle()
    assert.deepEqual(ctx.replacedUrls, ['http://portal.test/news/bai-viet?comments=2#comment-45'], 'refused clipboard: the address goes to the bar')
  })

  it('the pager reads the next page and drops the highlight; prev is disabled on page 1', async (t) => {
    const server = seeded()
    server.state.pages[2] = [comment(45)]
    const ctx = await openThread(t, server, { hash: '#comment-1' })
    assert.equal(button(ctx.thread, 'Trước').props.disabled, true)
    const from = ctx.calls.length
    await click(button(ctx.thread, 'Sau'))
    await ctx.settle()
    assert.deepEqual(sent(ctx.calls, from), ['GET /api/public/comments/bai-viet?page=2'])
    assert.ok(hasComment(ctx.thread, 45))
    assert.equal(button(ctx.thread, 'Sau').props.disabled, true)
    assert.doesNotMatch(String(commentEl(ctx.thread, 45).props.class), /ring-2/)
  })

  it('FINDING-C1: the pager label is "Trang 1 / 2", not the raw template', async (t) => {
    // RED on the base: `{{ t('page_of') || 'Trang' }} {{ page }} / {{ totalPages }}` with
    // page_of = "Trang {current} / {total}" printed "Trang {current} / {total} 1 / 2".
    const server = seeded()
    server.state.pages[2] = [comment(45)]
    const ctx = await openThread(t, server)
    const pager = button(ctx.thread, 'Sau').parent!
    // (Text nodes of sibling elements join without a space — the compiler drops the
    // whitespace between tags.)
    assert.equal(textOf(pager), 'TrướcTrang 1 / 2Sau')
  })
})

describe('source of truth for the read', () => {
  it('the thread response shape drives the count, the pages and the switch', async (t) => {
    const server = seeded()
    server.state.override = call => (call.method === 'GET'
      ? json({ ok: true, enabled: true, signedIn: false, comments: [comment(1)], total: 41, page: 1, perPage: 20, totalPages: 3 })
      : undefined)
    const ctx = await openThread(t, server)
    assert.match(textOf(section(ctx.thread)!), /Bình luận \(41\)/)
    assert.equal(button(ctx.thread, 'Sau').props.disabled, false)
  })
})
