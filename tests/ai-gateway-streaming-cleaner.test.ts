/**
 * Regression tests for `createStreamingCleaner` — the incremental cleaner that
 * emits cleaned chunks during streaming.
 *
 * The original bug had two halves, both fixed here:
 *
 * 1. `cleanAiContent` called `.trim()`. Applied to each chunk, the trailing
 *    space between words was stripped ("Chào " → "Chào"), so the next chunk
 *    glued words together ("Chào" + "anh" = "Chàoanh"). Fixed by splitting a
 *    no-trim `cleanAiContentCore` used during streaming; `cleanAiContent`
 *    (with trim) is reserved for the final answer.
 *
 * 2. `slice(emittedLen)` indexed by byte length. `cleanAiContent` runs regexes
 *    that *delete* spans (reasoning tags, "Actually, I'll try…" leaks) and
 *    those spans straddle chunk boundaries: the opening tag arrives in chunk N
 *    (already emitted), the closing tag in chunk M. Once the closer arrives,
 *    `cleaned` shrinks *ahead of* the emit point, so `slice(emittedLen)`
 *    indexes into the wrong position and emits garbled text — missing spaces,
 *    merged/dropped characters ("Chào anh/chị" → "Chàochị",
 *    "tôi có thể giúp anh" → "tôi cóợcanh"). Fixed by tracking the emitted
 *    *string* and emitting by prefix-diff: normal extension → suffix; tail
 *    deletion → nothing (resync); divergence → whole new text.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

const { createStreamingCleaner } = await import('../server/services/ai-gateway.ts')

const THINK_OPEN = '<' + 'thi' + 'nk>'
const THINK_CLOSE = '<' + '/thi' + 'nk>'
const CH_OPEN = '<|' + 'channel' + '>'
const CH_CLOSE = '<' + 'channel' + '|>'

/** Replays a list of raw deltas and returns the concatenated emitted output. */
function replay(deltas: string[]): string {
  const cleaner = createStreamingCleaner()
  let emitted = ''
  for (const d of deltas) {
    const chunk = cleaner.push(d)
    if (chunk) emitted += chunk
  }
  const tail = cleaner.flush()
  if (tail) emitted += tail
  return emitted
}

test('passes through plain text split across chunks without dropping spaces', () => {
  const raw = 'Chào anh/chị, tôi có thể giúp gì cho anh/chị ạ? Nếu anh/chị đang cần tìm hiểu về các thủ tục.'
  const deltas = raw.match(/\S+\s*/g) ?? [raw]
  assert.equal(replay(deltas), raw)
})

test('emits intact Vietnamese when chunks split words mid-token', () => {
  const raw = 'Chào anh/chị, tôi có thể giúp anh. Nếu anh cần, hãy hỏi tôi.'
  const deltas = [raw.slice(0, 12), raw.slice(12, 25), raw.slice(25, 40), raw.slice(40)]
  assert.equal(replay(deltas), raw)
})

test('think-tag spanning chunk boundaries does not corrupt emitted text', () => {
  // Opening tag in chunk 2, closing tag in chunk 4 — the deletion straddles
  // the emit point. Before the fix, slice(emittedLen) shifted and emitted
  // garbled text. After the fix, the held-back region is dropped wholesale
  // and the visible text stays intact.
  const deltas = ['Chào bạn, ', THINK_OPEN + 'this is hidden reasoning', ' more hidden' + THINK_CLOSE, ' tôi có thể giúp.']
  const emitted = replay(deltas)
  assert.ok(!emitted.includes('hidden reasoning'), 'reasoning content must not leak')
  assert.ok(emitted.includes('Chào bạn, '), 'greeting before the tag must survive with its trailing space')
  assert.ok(emitted.includes('tôi có thể giúp.'), 'text after the tag must survive')
})

test('"Actually, I will try" leak straddling chunks is stripped without shifting emit offset', () => {
  const deltas = [
    "Actually, I'll try to think about this more carefully. ",
    'Let me reconsider the approach. ',
    'Chào anh/chị, tôi có thể giúp gì cho anh/chị ạ?',
  ]
  const emitted = replay(deltas)
  assert.ok(!emitted.includes('Actually'), 'reasoning leak must be stripped')
  assert.ok(!emitted.includes('Let me reconsider'), 'reasoning continuation must be stripped')
  assert.ok(emitted.includes('Chào anh/chị, tôi có thể giúp'), 'the real greeting must survive intact')
})

test('"Actually, I will try" (no contraction) leak is also stripped', () => {
  // Some providers emit the full form "I will" instead of "I'll". The earlier
  // pattern only matched "I'll", so this leak passed through raw. Both forms
  // must be stripped.
  const deltas = [
    'Actually, I will try to think about this. ',
    'Let me reconsider. ',
    'Dạ, chào anh/chị, tôi là trợ lý ảo của Bộ Công An.',
  ]
  const emitted = replay(deltas)
  assert.ok(!emitted.includes('Actually'), 'full-form leak must be stripped')
  assert.ok(!emitted.includes('Let me reconsider'), 'continuation must be stripped')
  assert.ok(
    emitted.includes('Dạ, chào anh/chị, tôi là trợ lý ảo của Bộ Công An.'),
    'the real greeting must survive intact',
  )
})

test('flush emits nothing when no trailing carry is held', () => {
  const cleaner = createStreamingCleaner()
  let emitted = ''
  emitted += cleaner.push('Hello ')
  emitted += cleaner.push('world')
  const tail = cleaner.flush()
  assert.equal(tail, '')
  assert.equal(emitted, 'Hello world')
})

test('multiple reasoning blocks across many chunks all stay clean', () => {
  const deltas = [
    THINK_OPEN + 'first thought',
    THINK_CLOSE + 'Dạ, ',
    '',
    'theo quy định hiện hành, ',
    'thủ tục bao gồm ',
    THINK_OPEN + 'third' + THINK_CLOSE,
    'ba bước chính.',
  ]
  const emitted = replay(deltas)
  assert.ok(!emitted.includes('first thought'))
  assert.ok(!emitted.includes('third'))
  assert.ok(emitted.includes('Dạ, theo quy định'))
  assert.ok(emitted.includes('ba bước chính.'))
})

test('divergent continuation (new sentence) does not duplicate or drop text', () => {
  // After emitting "Hello ", a delta that is not an extension of "Hello "
  // ("world") and is not a deletion of it must still emerge intact — the
  // earlier "deleted region" branch wrongly swallowed it. The coincidental
  // shared "C" between "Cục " and "C11." must not be eaten by a common-prefix
  // slice either.
  assert.equal(replay(['Hello ', 'world']), 'Hello world')
  assert.equal(replay(['A ', 'B ', 'C']), 'A B C')
  assert.equal(replay(['Cục ', 'C11.']), 'Cục C11.')
})

test('partial trailing think-tag at chunk boundary is held back until processed', () => {
  const cleaner = createStreamingCleaner()
  const first = cleaner.push('Hello <' + 'thi')
  // The held-back "<thi" must NOT emit as part of the visible text — the
  // visitor would see a raw tag on screen.
  assert.equal(first, 'Hello ')
  // Stream close the tag and continue. The full opening  + closing
  //  plus the trailing "hidden world" forms a matched reasoning span that
  // cleans to "" — so only "hidden world" emerges (no leading space: the
  // closing tag abuts the text in this fixture).
  const second = cleaner.push('nk>' + THINK_CLOSE + 'hidden world')
  assert.equal(second, 'hidden world')
  const tail = cleaner.flush()
  assert.equal(tail, '')
})

test('a think-tag that opens and closes across chunks is fully stripped', () => {
  const cleaner = createStreamingCleaner()
  let emitted = ''
  emitted += cleaner.push('Before ')
  emitted += cleaner.push(THINK_OPEN + 'reasoning logic here')
  emitted += cleaner.push(THINK_CLOSE + ' after text.')
  emitted += cleaner.flush()
  assert.ok(!emitted.includes('logic here'), 'content between the tags is stripped')
  assert.ok(emitted.includes('Before '), 'text before the tag survives')
  assert.ok(emitted.includes('after text.'), 'text after the tag survives')
})

test('consecutive words streamed one-by-one keep all spaces', () => {
  const words = ['Tôi ', 'là ', 'trợ lý ', 'ảo ', 'của ', 'Cục ', 'C11.']
  assert.equal(replay(words), 'Tôi là trợ lý ảo của Cục C11.')
})

test('channel-tag streams are stripped without garbling the visible answer', () => {
  const deltas = [CH_OPEN + 'thought this is internal', CH_CLOSE + ' visible answer text']
  const emitted = replay(deltas)
  assert.ok(!emitted.includes('internal'), 'channel-tag content must not leak')
  assert.ok(emitted.includes('visible answer text'), 'visible answer must survive')
})

test('plain Vietnamese with no reasoning markers passes through byte-identical (fast path)', () => {
  // "AI trả sao thì giữ nguyên": when the stream contains no think-tag,
  // channel-tag or "Actually, I'll try" leak, the cleaner must return the
  // input unchanged — no regex pass, no prefix-diff, no hold-back. The
  // earlier implementation re-ran 8 regexes + a prefix-diff on every chunk
  // even when they could never match; any off-by-one in `emittedText`
  // tracking (e.g. after a partial `<` hold that turned out to be a
  // less-than sign) corrupted plain Vietnamese that should never have
  // entered the cleaning path. This test guards that regression: the
  // emitted text equals the input byte for byte across three chunking
  // strategies.
  const full =
    'Dạ, chào anh/chị, tôi rất hỗ trợ anh/chị về lý Hướng Thiện sẽ đồng hành cùng anh/chị trong các chính sách quy định. Anh/chị hoàn lương và muốn hỗ trợ, tôi sẽ cố đáp tận tình.'
  assert.equal(replay(full.match(/\S+\s*/g) ?? [full]), full, 'word-stream preserves text')
  const charDeltas: string[] = []
  for (let i = 0; i < full.length; i += 3) charDeltas.push(full.slice(i, i + 3))
  assert.equal(replay(charDeltas), full, 'char-stream preserves text')
  assert.equal(replay([full]), full, 'single-delta preserves text')
})
