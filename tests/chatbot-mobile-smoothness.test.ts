import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parse } from '@vue/compiler-sfc'
import { effectScope, nextTick, ref } from 'vue'

import { renderChatMarkdown, renderChatMarkdownBlocks } from '../app/utils/markdown'
import { CHAT_BOTTOM_THRESHOLD_PX, useChatAutoScroll } from '../app/composables/useChatAutoScroll'
import { CHATBOT_COMPOSABLE_FAMILY, moduleFamilySource, readAppFile } from './_component-family.ts'

/**
 * Chatbot trên điện thoại "không mượt" — đo bằng trình duyệt ở 390×844 trước khi
 * sửa: câu trả lời có ảnh bìa bài viết kết thúc với khung chat đứng giữa câu trả
 * lời, cách đáy 858px, và CLS 0.22. Ba nguyên nhân, mỗi nguyên nhân một nhóm test:
 *
 *  1. Ảnh không giữ chỗ → cao 0px tới khi tải xong rồi đẩy mọi thứ xuống.
 *  2. Một `v-html` cho cả câu trả lời → mỗi chunk stream dựng lại mọi node, kể
 *     cả ảnh đã hiện từ trước.
 *  3. "Có đang ở đáy không" được đo SAU khi nội dung cao lên → ảnh tải xong là
 *     đủ để khung kết luận người đọc đã cuộn lên, và ngừng bám đáy.
 *
 * Thêm: ô nhập dưới 16px khiến iOS Safari tự phóng to trang khi chạm vào.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const SURFACES = ['../app/components/ChatWidget.vue', '../app/pages/assistant.vue'] as const
const templateOf = (file: string) => parse(read(file), { filename: file }).descriptor.template?.content ?? ''

const STREAMED_ANSWER = [
  'Chào anh/chị,',
  'Theo **Quyết định số 22/2023/QĐ-TTg**, người chấp hành xong án phạt tù được hỗ trợ vay vốn.',
  '',
  '**Thủ tục:**',
  '1. Lập hồ sơ đề nghị vay vốn.',
  '2. Nộp hồ sơ tại Ngân hàng Chính sách xã hội.',
  '',
  'Mời anh/chị tham khảo:',
  '![Cà Mau ra mắt mô hình](https://cdn1.delify.vn/2026/09/ca-mau.png)',
  '* [CÀ MAU: Ra mắt mô hình hỗ trợ](/news/ca-mau-ra-mat-mo-hinh)',
  '* [THANH HOÁ: Chung tay giúp người hoàn lương](/news/thanh-hoa-chung-tay)',
  '',
  'Hotline **0903.480.985**.',
].join('\n')

// ─── 1. Ảnh giữ chỗ ──────────────────────────────────────────────────────────

test('media cards reserve their height before the image loads', () => {
  const html = renderChatMarkdown('![Ảnh](https://cdn1.delify.vn/a.png)\n![Video phóng sự](/media/abc123)')
  const images = html.match(/<img[^>]*>/g) ?? []
  assert.equal(images.length, 2)
  for (const img of images) {
    assert.match(img, /aspect-video/, `an image without a fixed ratio is 0px tall until decoded: ${img}`)
    assert.match(img, /width="\d+" height="\d+"/, 'intrinsic size lets the browser reserve space before CSS applies')
    assert.doesNotMatch(img, /max-h-/, 'a max-height alone reserves nothing')
  }
})

// ─── 2. Khối ổn định khi stream ──────────────────────────────────────────────

test('blocks join back to exactly the single-string render', () => {
  assert.equal(renderChatMarkdownBlocks(STREAMED_ANSWER).join('\n'), renderChatMarkdown(STREAMED_ANSWER))
  assert.deepEqual(renderChatMarkdownBlocks(''), [])
})

test('appending text never rewrites a block that is already on screen', () => {
  // Re-render after every character, the worst case of a token-level stream.
  // Only the last block may change; any earlier one changing means its DOM —
  // the cover image included — would be torn down and rebuilt.
  let previous: string[] = []
  const rewritten: string[] = []
  for (let end = 1; end <= STREAMED_ANSWER.length; end++) {
    const current = renderChatMarkdownBlocks(STREAMED_ANSWER.slice(0, end))
    for (let index = 0; index < Math.min(previous.length, current.length) - 1; index++) {
      if (previous[index] !== current[index]) rewritten.push(`at ${end}: block ${index}`)
    }
    previous = current
  }
  assert.deepEqual(rewritten, [])
  assert.ok(previous.some(block => block.includes('<img')), 'the sample must contain the image this protects')
})

test('headings, media cards and code are blocks of their own, not inside a <p>', () => {
  const blocks = renderChatMarkdownBlocks('### Tiêu đề\nnội dung\n![Ảnh](/uploads/a.png)\n```\nconst a = **b**\n\nconst c = 1\n```\nhết')
  for (const block of blocks) assert.doesNotMatch(block, /^<p[^>]*><(h\d|div|pre)/, `invalid nesting: ${block.slice(0, 80)}`)
  const code = blocks.find(block => block.startsWith('<pre'))
  assert.ok(code, 'the fenced block must render as one <pre>')
  assert.match(code, /const a = \*\*b\*\*\n\nconst c = 1/, 'code keeps its blank line and is not run through the bold rule')
})

test('the message body binds one v-html per block', () => {
  const template = templateOf('../app/components/ChatMessageContent.vue')
  assert.match(template, /v-for="\(block, index\) in blocks"[^>]*v-html="block"/)
  assert.doesNotMatch(template, /v-html="renderChatMarkdown\(/, 'one v-html for the whole answer rebuilds every node per chunk')
})

// `useChatbot` is a facade over `composables/chatbot/*.ts` since its wave3 split: the
// stream code is read as the composable's family (tests/_component-family.ts).
const composableSource = (overrides?: Record<string, string>) => moduleFamilySource(CHATBOT_COMPOSABLE_FAMILY, overrides)

function streamFlushProblems(source: string): string[] {
  const problems: string[] = []
  if (!/scheduleStreamFlush\(streamFlush\)/.test(source)) problems.push('the read loop must queue, not write, each chunk')
  if (!/requestAnimationFrame\(fire\)/.test(source)) problems.push('the queued copy must wait for a frame')
  if (!/flushStreamNow\(streamFlush\)\s*\n\s*if \(buffer\)/.test(source)) problems.push('whatever is queued must land before playback reads the transcript')
  if (!/catch \(error\) \{[\s\S]{0,200}cancelStreamFlush\(streamFlush\)/.test(source)) problems.push('a queued frame must not re-add a removed bot message')
  return problems
}

function flushHeightProblems(source: string): string[] {
  const flush = source.match(/const flushToTranscript = \(\) => \{[\s\S]*?\n {4}\}/)?.[0] ?? ''
  if (!flush) return ['flushToTranscript not found']
  const problems: string[] = []
  // The question's "Đang gửi…" line goes when the reply bubble arrives, in the
  // same frame — not when the stream closes, under a finished answer.
  if (!/question\?\.status === 'pending'\) question\.status = undefined/.test(flush)) problems.push('the question stops "sending" with the first word')
  // The pending indicator goes at the first word, not at the end of the stream.
  if (!/isReplyStreaming\.value = true/.test(flush)) problems.push('the indicator goes at the first word')
  if (!/const isAwaitingFirstWord = computed\(\(\) => isSubmitting\.value && !isReplyStreaming\.value\)/.test(source)) problems.push('isAwaitingFirstWord is gated on the first word')
  return problems
}

test('stream chunks reach the transcript at most once per frame', () => {
  assert.deepEqual(streamFlushProblems(composableSource()), [])
})

test('nothing above the reply changes height once the reply has started', () => {
  assert.deepEqual(flushHeightProblems(composableSource()), [])
})

test('injection proof: the stream checks read the modules that carry the code', () => {
  const send = 'composables/chatbot/send.ts'
  const state = 'composables/chatbot/state.ts'
  const breakIn = (file: string, from: string, to: string) => {
    const source = readAppFile(file)
    assert.ok(source.includes(from), `${file} no longer contains ${from}`)
    return composableSource({ [file]: source.replace(from, to) })
  }
  assert.notDeepEqual(streamFlushProblems(breakIn(send, 'scheduleStreamFlush(streamFlush)', 'flushStreamNow(streamFlush)')), [])
  assert.notDeepEqual(streamFlushProblems(breakIn(send, 'cancelStreamFlush(streamFlush)\n', '\n')), [])
  assert.notDeepEqual(flushHeightProblems(breakIn(send, "if (question?.status === 'pending') question.status = undefined", '')), [])
  assert.notDeepEqual(flushHeightProblems(breakIn(state, '&& !isReplyStreaming.value', '')), [])
})

// ─── 3. Bám đáy theo ý người đọc ─────────────────────────────────────────────

type Listener = () => void

/**
 * A scroll container in the shape the composable reads. Programmatic writes to
 * `scrollTop` fire `scroll` like a browser does, so the "ignore our own scroll"
 * path is exercised rather than skipped.
 */
function fakeScroller(clientHeight: number) {
  const listeners: Listener[] = []
  let top = 0
  const el = {
    scrollHeight: clientHeight,
    clientHeight,
    get scrollTop() { return top },
    set scrollTop(value: number) { top = Math.max(0, Math.min(value, el.scrollHeight - el.clientHeight)); listeners.forEach(fn => fn()) },
    getBoundingClientRect: () => ({ top: 0 }),
    addEventListener: (_: string, fn: Listener) => { listeners.push(fn) },
    removeEventListener: () => {},
  }
  return { el, userScrollTo: (value: number) => { el.scrollTop = value } }
}

async function withAutoScroll(run: (ctx: {
  scroller: ReturnType<typeof fakeScroller>
  grow: (px: number) => void
  ask: (height?: number) => void
  api: ReturnType<typeof useChatAutoScroll>
}) => Promise<void> | void) {
  const callbacks: (() => void)[] = []
  const previous = globalThis.ResizeObserver
  globalThis.ResizeObserver = class {
    constructor(cb: () => void) { callbacks.push(cb) }
    observe() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  const scope = effectScope()
  try {
    const scroller = fakeScroller(600)
    // Questions sit at a fixed offset in the content; their on-screen rect
    // moves with scrollTop, exactly as getBoundingClientRect would report.
    const questions: { getBoundingClientRect: () => { top: number, height: number } }[] = []
    const content = { querySelectorAll: () => questions } as unknown as HTMLElement
    const api = scope.run(() => useChatAutoScroll(ref(scroller.el as unknown as HTMLElement), ref(content)))!
    await nextTick()
    // Content growth fires no scroll event — only the ResizeObserver hears it.
    const grow = (px: number) => { scroller.el.scrollHeight += px; callbacks.forEach(cb => cb()) }
    const ask = (height = 60) => {
      const offset = scroller.el.scrollHeight
      questions.push({ getBoundingClientRect: () => ({ top: offset - scroller.el.scrollTop, height }) })
      grow(height)
    }
    await run({ scroller, grow, ask, api })
  } finally {
    scope.stop()
    globalThis.ResizeObserver = previous
  }
}

test('a late-loading image keeps a pinned transcript at the bottom', async () => {
  await withAutoScroll(({ scroller, grow, api }) => {
    api.pinToBottom()
    grow(400) // the answer's text
    assert.equal(scroller.el.scrollTop, scroller.el.scrollHeight - scroller.el.clientHeight)
    // The cover image decodes: +220px in one step, far past the 80px threshold
    // the old "measure after growth" check used.
    grow(220)
    assert.ok(220 > CHAT_BOTTOM_THRESHOLD_PX)
    assert.equal(api.isPinnedToBottom.value, true, 'growth alone must not count as the visitor scrolling up')
    assert.equal(scroller.el.scrollTop, scroller.el.scrollHeight - scroller.el.clientHeight)
  })
})

test('a visitor who scrolls up is left where they are', async () => {
  await withAutoScroll(({ scroller, grow, api }) => {
    grow(2000)
    api.pinToBottom()
    scroller.userScrollTo(300) // reading an earlier answer
    assert.equal(api.isPinnedToBottom.value, false)
    grow(500)
    assert.equal(scroller.el.scrollTop, 300, 'new text must not drag the view away from what they are reading')
    // Scrolling back down re-pins.
    scroller.userScrollTo(scroller.el.scrollHeight - scroller.el.clientHeight)
    assert.equal(api.isPinnedToBottom.value, true)
  })
})

test('a long answer that lands at once is read from its first line', async () => {
  await withAutoScroll(({ scroller, grow, ask, api }) => {
    grow(1500) // earlier conversation
    api.pinToBottom()
    api.followLatestQuestion()
    const questionOffset = scroller.el.scrollHeight // where `ask` places it: 600 + 1500
    ask()
    grow(1250) // a quoted legal answer, twice the panel's height, in one chunk
    assert.equal(scroller.el.scrollTop, questionOffset - 12, 'the view stops with the question at the top edge')
    assert.ok(
      scroller.el.scrollHeight - scroller.el.clientHeight - scroller.el.scrollTop > 600,
      'the reader must not be dropped at the end of the answer',
    )
    assert.equal(api.isPinnedToBottom.value, true, 'stopping at the question is our scroll, not the visitor scrolling up')
  })
})

test('a short answer is still followed to its end', async () => {
  await withAutoScroll(({ scroller, grow, ask, api }) => {
    grow(1500)
    api.followLatestQuestion()
    ask()
    grow(200)
    assert.equal(scroller.el.scrollTop, scroller.el.scrollHeight - scroller.el.clientHeight)
  })
})

test('the first scroll by the visitor drops the stop at the question', async () => {
  await withAutoScroll(({ scroller, grow, ask, api }) => {
    grow(1500)
    api.followLatestQuestion()
    ask()
    grow(1250)
    scroller.userScrollTo(scroller.el.scrollHeight - scroller.el.clientHeight) // reads down to the end
    grow(300) // sources and tool details appear
    assert.equal(scroller.el.scrollTop, scroller.el.scrollHeight - scroller.el.clientHeight, 'a reader at the bottom keeps following')
  })
})

test('both surfaces decide "follow" from the pinned state, not a post-growth measurement', () => {
  for (const file of SURFACES) {
    const source = read(file)
    assert.match(source, /useChatAutoScroll\(chatContainer, chatContent\)/, `${file} must use the shared follow logic`)
    for (const send of source.matchAll(/(?:const sendBotMessage|const askBot|function retryMessage)[\s\S]*?submitBotQuestion\(/g)) {
      assert.match(send[0], /followLatestQuestion\(\)/, `${file}: a send must stop the follow at the new question`)
    }
    assert.match(templateOf(file), /:data-chat-anchor="msg\.sender === 'user'/, `${file}: questions must be marked as stops`)
    assert.match(source, /const wasAtBottom = force \|\| isPinnedToBottom\.value/, file)
    assert.doesNotMatch(source, /el\.scrollHeight - el\.scrollTop - el\.clientHeight < 80/, `${file} still measures after growth`)
    assert.match(templateOf(file), /ref="chatContent"/, `${file} needs an inner block for the ResizeObserver`)
  }
})

// ─── Điện thoại: bàn phím, zoom, trình đọc màn hình ──────────────────────────

test('text inputs are 16px on phones so iOS Safari does not zoom on focus', () => {
  for (const file of SURFACES) {
    const tags = templateOf(file).match(/<(input|textarea)\b[^>]*>/g) ?? []
    const visible = tags.filter(tag => !/name="_h"/.test(tag))
    assert.ok(visible.length > 0, `${file} has text inputs`)
    for (const tag of visible) {
      // A bare `text-[0.88rem]` (no breakpoint prefix) applies on phones.
      assert.doesNotMatch(tag, /(?<![:\w-])text-\[0?\.\d+rem\]/, `${file}: below 16px on phones: ${tag.slice(0, 120)}`)
      assert.match(tag, /\btext-base\b/, `${file}: ${tag.slice(0, 120)}`)
    }
  }
})

test('the full-screen widget follows the visible viewport when the keyboard opens', () => {
  const template = templateOf('../app/components/ChatWidget.vue')
  const dialog = template.match(/id="public-chatbot-dialog"[\s\S]*?\n\s*>/)?.[0] ?? ''
  assert.match(dialog, /:style="keyboardViewportStyle"/)
  // Animating top/height would trail the keyboard by 300ms.
  assert.doesNotMatch(dialog, /\btransition-all\b/)
  // Closed means not painted: the header's pulse and the transcript stop costing frames.
  assert.match(dialog, /\binvisible\b/)
  assert.match(dialog, /!visible/)

  const composable = read('../app/composables/useKeyboardViewport.ts')
  assert.match(composable, /visualViewport/)
  assert.match(composable, /min-width: 768px/, 'the floating desktop panel must not be resized')
})

test('message bubbles are not alerts', () => {
  // Every streamed chunk changes the bubble's text. As `role="alert"` each change
  // was an assertive interruption, and every past message was an alert too.
  for (const file of SURFACES) {
    const template = templateOf(file)
    const bubble = template.match(/<div\s+class="max-w-\[8\d%\][^>]*>/)?.[0]
    assert.ok(bubble, `${file}: bubble not found`)
    assert.doesNotMatch(bubble, /role="alert"/, file)
  }
})
