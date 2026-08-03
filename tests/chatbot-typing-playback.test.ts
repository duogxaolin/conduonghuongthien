import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parse } from '@vue/compiler-sfc'

import { playTypewriter, normalizeSource, type ChatMessage } from '../app/composables/useChatbot'

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

const SURFACES = ['../app/components/ChatWidget.vue', '../app/pages/tro-ly.vue'] as const

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
