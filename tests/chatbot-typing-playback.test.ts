import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parse } from '@vue/compiler-sfc'
import { nextTick, ref, watchEffect } from 'vue'

import { playTypewriter, normalizeSource, TYPEWRITER_MAX_MS, TYPEWRITER_WORD_DELAY_MS, type ChatMessage } from '../app/composables/useChatbot'

/**
 * The waiting/typing indicator and the reveal animation, tested by *running*
 * them rather than by grepping for the lines that implement them.
 *
 * The sibling suites (`chatbot-public-widget`, `chatbot-live-sessions`) assert
 * source text, which pins the shape of the code but proved nothing about what a
 * visitor sees — the blink animation was broken for its entire life and every
 * text assertion about it stayed green. Everything below either executes the
 * function or inspects the compiled template, so a defect has to survive an
 * actual run to reach production.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

const SURFACES = ['../app/components/ChatWidget.vue', '../app/pages/assistant.vue'] as const

function botMessage(): ChatMessage {
  return { id: 'bot-test', sender: 'bot', text: '' }
}

// ─── Playback ────────────────────────────────────────────────────────────────

test('the first word is on screen before the first interval elapses', async () => {
  // The bot bubble joins the transcript and the typing indicator disappears in
  // the same tick. If the first word waited for the timer, that swap showed an
  // empty white box for one frame — a flicker exactly where the answer should be.
  const message = botMessage()
  const playback = playTypewriter(message, 'Xin chào anh chị', { delayMs: 1 })
  assert.notEqual(message.text, '', 'the bubble was empty at the moment playback began')
  assert.equal(message.isStreaming, true)
  await playback
  assert.equal(message.text, 'Xin chào anh chị')
  assert.equal(message.isStreaming, false)
})

test('the revealed text is byte-identical to what arrived', async () => {
  // Legal text carries its own line breaks and numbering. A split that dropped
  // separators would silently reformat an approved answer on its way to screen.
  const full = 'Điều 1.\n\n  Khoản a:  hai khoảng trắng\nKhoản b'
  const message = botMessage()
  await playTypewriter(message, full, { delayMs: 1 })
  assert.equal(message.text, full)
})

test('a one-word answer still clears isStreaming', async () => {
  // `isStreaming` gates the kind label, the sources list and the lead form. Left
  // set, a complete reply would render permanently stripped of all three.
  const message = botMessage()
  await playTypewriter(message, 'Vâng', { delayMs: 1 })
  assert.equal(message.text, 'Vâng')
  assert.equal(message.isStreaming, false)
})

test('reduced motion and delayMs 0 both settle without animating', async () => {
  const message = botMessage()
  await playTypewriter(message, 'Nội dung đầy đủ ngay lập tức', { delayMs: 0 })
  assert.equal(message.text, 'Nội dung đầy đủ ngay lập tức')
  assert.equal(message.isStreaming, false)
})

// ─── Pacing ──────────────────────────────────────────────────────────────────

test('the pace is slow enough to read and the cap is short enough to sit through', () => {
  // Both numbers have been retuned twice in opposite directions — first too slow
  // (~10s on a long answer), then too fast to read (a median 33-word reply flashed
  // by in under a second). These bounds pin the window that complaint pair leaves
  // open, so the next adjustment cannot silently walk back out of it.
  assert.ok(
    TYPEWRITER_WORD_DELAY_MS >= 45 && TYPEWRITER_WORD_DELAY_MS <= 110,
    `${TYPEWRITER_WORD_DELAY_MS}ms per word is outside the readable band (~9-22 words/second)`,
  )
  assert.ok(
    TYPEWRITER_MAX_MS >= 3000 && TYPEWRITER_MAX_MS <= 8000,
    `a ${TYPEWRITER_MAX_MS}ms cap is either too tight to read or long enough to feel like a wait`,
  )
})

test('a short reply is paced by the per-word delay, not by the refresh rate', async () => {
  // The defect this pins: `target` used to carry a `Math.max(index + 1, …)` floor,
  // so every animation frame advanced at least one word and playback ran at ~60
  // words/second whatever the constant said. Raising the delay changed nothing a
  // visitor could see, because the floor — not the clock — set the pace for any
  // answer short enough to stay under the cap. The everyday replies measure a
  // median of 33 words, so that covers effectively all of them.
  const words = 20
  const reply = 'từ '.repeat(words).trim()
  const expected = words * TYPEWRITER_WORD_DELAY_MS
  assert.ok(expected < TYPEWRITER_MAX_MS, 'sample must stay under the cap to test the per-word path')

  const message = botMessage()
  const startedAt = performance.now()
  await playTypewriter(message, reply)
  const elapsed = performance.now() - startedAt

  assert.equal(message.text, reply)
  assert.ok(
    elapsed > expected * 0.6,
    `${words} words took ${Math.round(elapsed)}ms; at ${TYPEWRITER_WORD_DELAY_MS}ms/word it should approach ${expected}ms, so something is outrunning the clock`,
  )
})

test('a long answer finishes in bounded time instead of scaling with length', async () => {
  // The complaint this fixes: at a fixed per-word delay, the knowledge bank's
  // longer legal answers (~330 words) took ~10 seconds. The whole answer was
  // already in memory; the visitor was made to wait for an animation.
  const long = 'Theo quy định tại Nghị định số 49/2020/NĐ-CP về tái hòa nhập cộng đồng, '.repeat(30)
  const words = (long.match(/\S+\s*/g) ?? []).length
  assert.ok(words > 300, `sample should be long; got ${words} words`)
  assert.ok(
    words * TYPEWRITER_WORD_DELAY_MS > TYPEWRITER_MAX_MS * 2,
    'sample must be long enough that the cap is what bounds it, not the per-word pace',
  )

  const message = botMessage()
  const startedAt = performance.now()
  await playTypewriter(message, long)
  const elapsed = performance.now() - startedAt

  assert.equal(message.text, long, 'the full answer must still arrive intact')
  assert.ok(
    elapsed < TYPEWRITER_MAX_MS * 1.5,
    `${words} words took ${Math.round(elapsed)}ms against a ${TYPEWRITER_MAX_MS}ms cap; playback duration must not scale with answer length`,
  )
})

test('playback repaints once per frame, not once per word', async () => {
  // Each tick writes to the DOM and the surfaces then read `scrollHeight`, which
  // forces layout. One of those per word is one forced layout per word.
  const long = 'Người chấp hành xong hình phạt tù được hỗ trợ đào tạo nghề nghiệp. '.repeat(30)
  const words = (long.match(/\S+\s*/g) ?? []).length

  const message = botMessage()
  let ticks = 0
  await playTypewriter(message, long, { onTick: () => { ticks += 1 } })

  assert.equal(message.text, long)
  assert.ok(
    ticks < words,
    `${ticks} ticks for ${words} words; batches per frame are what keep layout work bounded`,
  )
})

test('both surfaces follow the transcript without seizing the scrollbar', () => {
  // Playback now ticks every frame, so an unconditional `scrollTop = scrollHeight`
  // would drag the view down repeatedly while the visitor is scrolled up reading
  // an earlier answer — they would physically be unable to stay there.
  for (const file of SURFACES) {
    const source = read(file)
    assert.match(source, /const wasAtBottom = force \|\|/, `${file} must check position before scrolling`)
    assert.match(source, /const followChatBottom = \(\) =>/, `${file} needs a follow-only wrapper for onTick`)
    // Playback and sends follow conditionally; opening/switching/mounting land at
    // the bottom on purpose and pass `force`.
    assert.match(source, /submitBotQuestion\([^)]*followChatBottom\)/, `${file} must pass the follow wrapper to playback`)
    assert.doesNotMatch(
      source,
      /submitBotQuestion\([^)]*, scrollChatBottom\)/,
      `${file} passes the raw scroll fn to playback, which forwards args into \`force\``,
    )
  }
})

// ─── Reactivity ──────────────────────────────────────────────────────────────

test('playback drives a re-render on every word, not just on the first', async () => {
  // The bug this pins: `conversations` is a `ref`, so Vue hands out a proxy per
  // element and only writes made *through that proxy* schedule a render. Playback
  // used to type into the raw object literal it had just pushed, so the data was
  // correct and nothing on screen moved — the bubble froze on the first word and
  // filled in all at once when the visitor sent their next message. Every
  // assertion in the rest of this file passed throughout, because they all
  // operate on plain objects where raw and proxy are the same thing.
  const conversations = ref<{ id: string, messages: ChatMessage[] }[]>([{ id: 'c1', messages: [] }])
  const conversation = conversations.value.find(item => item.id === 'c1')!

  const raw: ChatMessage = { id: 'bot-1', sender: 'bot', text: '' }
  conversation.messages.push(raw)

  let renders = 0
  let painted = ''
  watchEffect(() => {
    renders += 1
    painted = conversation.messages.map(item => item.text).join('')
  })
  await nextTick()
  const rendersBefore = renders

  // Read the element back out to get the tracked proxy — exactly what the
  // composable now hands to `playTypewriter`.
  const tracked = conversation.messages[conversation.messages.length - 1]!
  await playTypewriter(tracked, 'Vấn đề của anh chị', { delayMs: 1 })
  await nextTick()

  assert.equal(painted, 'Vấn đề của anh chị', 'the rendered text never caught up with the data')
  assert.ok(
    renders > rendersBefore + 1,
    `playback produced ${renders - rendersBefore} render(s); a frozen bubble that fills in later looks exactly like this`,
  )
})

test('the composable hands playback the array element, never the local literal', () => {
  // Guards the fix at its one call site. `playTypewriter(botMessage, ...)` reads
  // as correct and is the version that shipped broken, so the distinction needs
  // to be asserted rather than left to reviewer memory.
  const source = read('../app/composables/useChatbot.ts')
  const call = source.match(/playTypewriter\((\w+), accumulator\.text/)
  assert.ok(call, 'the playback call site moved; re-check that it passes a tracked element')
  assert.notEqual(
    call[1],
    'botMessage',
    'playback must receive the element read back out of conversation.messages, not the raw literal',
  )
  assert.match(
    source,
    /const tracked = conversation\.messages\[conversation\.messages\.length - 1\]!/,
    'the tracked element must come from the array Vue is observing',
  )
})

// ─── Reference identity ──────────────────────────────────────────────────────

test('the knowledge row id survives a reply and a storage round-trip', () => {
  // Rows imported from the officers' spreadsheet carry a source label and no URL,
  // so this id is the only handle on the approved answer behind a citation. It has
  // to survive `persist()` too, or a reload silently drops "Xem đầy đủ".
  const fresh = normalizeSource({
    id: 42,
    question: 'Thủ tục xóa án tích?',
    answer: 'Nội dung đã phê duyệt',
    source: { label: 'Tài liệu Hỏi – Đáp', reference: 'STT 7', url: null },
  }, 0)
  assert.ok(fresh)
  assert.equal(fresh.entryId, 42)
  assert.equal(fresh.url, null, 'a null url must stay null rather than becoming a link')

  const persisted = { label: fresh.label, reference: fresh.reference, url: fresh.url, entryId: fresh.entryId }
  assert.equal(normalizeSource(persisted, 0)?.entryId, 42, 'entryId was lost across a reload')
})

test('a reference without a usable numeric id offers no detail affordance', () => {
  assert.equal(normalizeSource({ source: { label: 'Tài liệu công khai' } }, 0)?.entryId, null)
  assert.equal(normalizeSource({ id: 'abc', source: { label: 'x' } }, 0)?.entryId, null)
  assert.equal(normalizeSource({ id: 0, source: { label: 'x' } }, 0)?.entryId, null)
  assert.equal(normalizeSource({ id: -3, source: { label: 'x' } }, 0)?.entryId, null)
})

// ─── The indicator, as compiled ──────────────────────────────────────────────

test('each surface renders exactly one pending indicator', () => {
  for (const file of SURFACES) {
    const template = parse(read(file), { filename: file }).descriptor.template?.content ?? ''
    assert.equal(
      (template.match(/v-if="isSubmitting"/g) ?? []).length,
      1,
      `${file} must have a single pending indicator`,
    )
    // The streaming cursor was a static block character: its keyframe lived in
    // `<style scoped>`, where Vue renames it, so the utility referenced a name
    // that existed nowhere. An empty bubble holding only that motionless glyph
    // sat beside the indicator for the whole network wait.
    assert.doesNotMatch(template, /▌/, `${file} still renders the dead streaming cursor`)
    assert.doesNotMatch(template, /msg\.isStreaming"[^>]*animate-/, `${file} animates on the streaming flag again`)
  }
})

test('no surface animates a keyframe that a scoped style block would rename', () => {
  // Custom keyframes belong in `tailwind.config.js theme.extend`, which emits them
  // into the global sheet. Declared in a component, Vue hashes the name and the
  // `animate-[name_...]` utility resolves to nothing, with no error anywhere.
  const config = read('../tailwind.config.js')
  for (const file of SURFACES) {
    const source = read(file)
    assert.ok(!source.includes('<style'), `${file} must not declare a <style> block`)
    for (const [, name] of source.matchAll(/animate-\[([A-Za-z][\w-]*)_/g)) {
      assert.fail(`${file} uses animate-[${name}_...]; register ${name} in tailwind.config.js instead`)
    }
    for (const [, utility] of source.matchAll(/\banimate-((?!none\b|pulse\b|spin\b|bounce\b|ping\b)[a-z][a-z-]*)\b/g)) {
      assert.match(
        config,
        new RegExp(`'${utility}':`),
        `${file} uses animate-${utility} but tailwind.config.js declares no such animation`,
      )
    }
  }
})

test('every animated dot in the indicator honours prefers-reduced-motion', () => {
  // A row of dots jumping forever is the kind of motion that setting exists to
  // turn off, and these two files are not on the decorative-pulse allowlist.
  for (const file of SURFACES) {
    const template = parse(read(file), { filename: file }).descriptor.template?.content ?? ''
    const animated = (template.match(/<[^>]*\banimate-typing-dot[^>]*>/g) ?? [])
    assert.ok(animated.length >= 3, `${file} must render the three-dot indicator`)
    for (const tag of animated) {
      assert.ok(
        tag.includes('motion-reduce:animate-none'),
        `${file} animates a dot without motion-reduce:animate-none: ${tag.slice(0, 120)}`,
      )
    }
  }
})

test('the indicator announces itself to assistive technology', () => {
  // Dots convey "wait" only to someone who can see them. Without the label, a
  // screen-reader user gets silence between sending and the answer arriving.
  for (const file of SURFACES) {
    const template = parse(read(file), { filename: file }).descriptor.template?.content ?? ''
    const block = template.match(/v-if="isSubmitting"[\s\S]{0,900}/)?.[0] ?? ''
    assert.match(block, /role="status"/, `${file} indicator needs role="status"`)
    assert.match(block, /sr-only/, `${file} indicator needs a text label`)
    assert.match(block, /Trợ lý đang soạn/, `${file} indicator label changed wording`)
  }
})

// ─── Reference detail affordance ─────────────────────────────────────────────

test('both surfaces offer the full approved answer with load, error and retry', () => {
  for (const file of SURFACES) {
    const template = parse(read(file), { filename: file }).descriptor.template?.content ?? ''
    assert.match(template, /source\.entryId !== null/, `${file} must gate the affordance on a real row id`)
    assert.match(template, /toggleSourceDetail\(source\.entryId\)/, `${file} must open the detail`)
    assert.match(template, /:aria-expanded="isSourceExpanded\(source\.entryId\)"/, `${file} must announce expansion`)

    // Loading / error / empty is one contract. Without the error branch a failed
    // fetch reads exactly like a citation with nothing behind it.
    assert.match(template, /Đang tải nội dung đầy đủ/, `${file} needs a loading branch`)

    // Matched on the error element itself, not on how near `role="alert"` happens
    // to sit to the retry button — the utility class strings between them run to
    // several hundred characters, so a proximity window measures formatting.
    const errorTag = template.match(/<[^>]*status === 'error'[^>]*>/)?.[0]
    assert.ok(errorTag, `${file} needs an error branch for the source detail`)
    assert.match(errorTag, /role="alert"/, `${file} error branch is silent to screen readers`)
    assert.match(template, /retrySourceDetail\(source\.entryId\)/, `${file} retry must re-run the failed fetch`)
    assert.match(template, />Thử lại</, `${file} needs a visible retry control`)
    assert.doesNotMatch(template, /location\.reload/, `${file} must not reload the page to retry`)

    // The answer is approved prose rendered as text. `v-html` here would put
    // knowledge-bank content on a path that executes markup.
    assert.doesNotMatch(template, /v-html/, `${file} must not render source detail as HTML`)
  }
})

test('the public source endpoint returns the answer it is asked for', () => {
  // The handler existed and was wired to nothing; it returned question and topic
  // but withheld `answer`, so a citation was visible and unreadable.
  const handler = read('../server/api/public/chatbot/sources.get.ts')
  assert.match(handler, /answer: result\.answer/)
  assert.match(handler, /eq\(chatbotKnowledge\.status, 'published'\)/, 'drafts must never be served publicly')
  for (const secret of ['internalNotes', 'sourceInternal', 'apiKey']) {
    assert.doesNotMatch(handler, new RegExp(secret, 'i'), `${secret} must not leave the server`)
  }
})
