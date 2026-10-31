import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { renderSfcTemplate } from './_render-sfc-template.ts'

/**
 * The AI verdict noted on a pending queue row (wave3/queue-ai-verdict): the one validator both
 * directions go through (`shared/moderation-ai-verdict.ts`), the words an officer reads
 * (`app/utils/queue-ai-verdict.ts`), and the two places it is rendered — the note itself
 * (`AdminQueueAiVerdictNote`) and the hidden line of /admin/comments (`AdminCommentHiddenNote`) —
 * rendered to HTML, not grepped. The end-to-end path (worker → column → endpoints) is
 * tests/moderation-queue-ai-verdict-behavior.test.ts.
 */

const { cleanQueueAiVerdictReason, queueAiVerdictFromReply, readQueueAiVerdict, QUEUE_AI_VERDICT_REASON_MAX_LENGTH } = await import('../shared/moderation-ai-verdict.ts')
const { queueAiVerdictSummary } = await import('../app/utils/queue-ai-verdict.ts')

const NOTE = new URL('../app/components/admin/QueueAiVerdictNote.vue', import.meta.url).pathname
const HIDDEN = new URL('../app/components/admin/CommentHiddenNote.vue', import.meta.url).pathname
const PANEL = new URL('../app/components/admin/ai/moderation/ModerationQueuePanel.vue', import.meta.url).pathname
const PAGE = new URL('../app/pages/admin/comments/index.vue', import.meta.url).pathname

/** SSR output without Vue's fragment markers (`<!--[-->`), so assertions read the text as shown. */
const renderNote = async (verdict: unknown) => (await renderSfcTemplate(NOTE, { verdict, queueAiVerdictSummary })).replace(/<!--.*?-->/g, '')

/** Characters by code unit, so this source carries no invisible character itself (Trojan Source). */
const ch = (...units: number[]) => String.fromCharCode(...units)

test('only the AI\'s two verdicts are stored; an unknown severity is "high", a reason that is not a string is empty', () => {
  assert.equal(queueAiVerdictFromReply({ verdict: 'safe', severity: 'low', reason: 'ok' }), null)
  assert.equal(queueAiVerdictFromReply({ verdict: 'VIOLATION', severity: 'high', reason: 'x' }), null)
  assert.equal(queueAiVerdictFromReply({ verdict: undefined, severity: 'high', reason: 'x' }), null)
  assert.deepEqual(queueAiVerdictFromReply({ verdict: 'spam', severity: 'critical', reason: ' a ' }), { verdict: 'spam', severity: 'critical', reason: 'a' })
  assert.deepEqual(queueAiVerdictFromReply({ verdict: 'violation', severity: 'extreme', reason: 42 }), { verdict: 'violation', severity: 'high', reason: '' })
})

test('the reason is cleaned and cut by code point', () => {
  // RLO, LRI, ZWJ, BOM (format characters), NUL (control), CR LF, LINE SEPARATOR.
  const dirty = `a${ch(0x202e)}b${ch(0x2066)}c${ch(0x200d)}d${ch(0xfeff)}e${ch(0)}f${ch(13, 10, 0x2028)}g`
  assert.equal(cleanQueueAiVerdictReason(dirty), 'abcde f g')
  assert.equal(cleanQueueAiVerdictReason(`x${ch(0xd800)}y`), 'xy', 'a lone surrogate is dropped')
  assert.equal(cleanQueueAiVerdictReason(null), '')
  const exact = 'ơ'.repeat(QUEUE_AI_VERDICT_REASON_MAX_LENGTH)
  assert.equal(cleanQueueAiVerdictReason(exact), exact, 'exactly the limit: kept whole, no ellipsis')
  const over = `${'ơ'.repeat(QUEUE_AI_VERDICT_REASON_MAX_LENGTH - 2)}😀😀😀`
  const cut = cleanQueueAiVerdictReason(over)
  assert.equal(Array.from(cut).length, QUEUE_AI_VERDICT_REASON_MAX_LENGTH)
  assert.ok(cut.endsWith('😀…'), cut.slice(-4))
})

test('reading the column: an object or its JSON text (MariaDB) with a known verdict and severity; anything else is null', () => {
  const good = { verdict: 'spam', severity: 'medium', reason: 'Quảng cáo cờ bạc' }
  assert.deepEqual(readQueueAiVerdict(good), good)
  assert.deepEqual(readQueueAiVerdict(JSON.stringify(good)), good)
  assert.deepEqual(readQueueAiVerdict({ ...good, reason: 7, extra: 'bỏ' }), { verdict: 'spam', severity: 'medium', reason: '' })
  for (const bad of [null, undefined, '', 'không phải JSON', '[1]', [good], 5, true, { ...good, verdict: 'safe' }, { ...good, severity: 'extreme' }, { reason: 'x' }]) {
    assert.equal(readQueueAiVerdict(bad), null, JSON.stringify(bad))
  }
})

test('the words: verdict and severity, in the queue table\'s severity words', () => {
  assert.equal(queueAiVerdictSummary({ verdict: 'violation', severity: 'critical', reason: '' }), 'Vi phạm, mức độ Nguy hiểm')
  assert.equal(queueAiVerdictSummary({ verdict: 'violation', severity: 'high', reason: '' }), 'Vi phạm, mức độ Cao')
  assert.equal(queueAiVerdictSummary({ verdict: 'spam', severity: 'medium', reason: '' }), 'Spam, mức độ Trung bình')
  assert.equal(queueAiVerdictSummary({ verdict: 'spam', severity: 'low', reason: '' }), 'Spam, mức độ Thấp')
})

test('the note renders nothing without a verdict', async () => {
  const html = await renderNote(null)
  assert.doesNotMatch(html, /AI kiểm duyệt|<p/)
})

test('the note: a labelled line, the icon hidden from screen readers, the model\'s reason as escaped text', async () => {
  const html = await renderNote({ verdict: 'violation', severity: 'high', reason: '<script>alert(1)</script> & "x"' })
  assert.match(html, /AI kiểm duyệt tự động đánh giá:/)
  assert.match(html, /Vi phạm, mức độ Cao — &lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;x&quot;/)
  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /<i class="fa-solid fa-robot[^"]*" aria-hidden="true">/)
})

test('the note with an empty reason: no dangling dash', async () => {
  const html = await renderNote({ verdict: 'spam', severity: 'low', reason: '' })
  assert.match(html, /Spam, mức độ Thấp/)
  assert.doesNotMatch(html, / — /)
})

test('no v-html in the two components; the page and the queue panel hand them the row\'s own field', () => {
  for (const file of [NOTE, HIDDEN]) assert.doesNotMatch(readFileSync(file, 'utf8'), /\bv-html\s*=/)
  assert.match(readFileSync(HIDDEN, 'utf8'), /<AdminQueueAiVerdictNote :verdict="aiVerdict"/)
  assert.match(readFileSync(PANEL, 'utf8'), /<AdminQueueAiVerdictNote :verdict="item\.aiVerdict"/)
  assert.match(readFileSync(PAGE, 'utf8'), /<AdminCommentHiddenNote v-if="comment\.isHidden" class="text-\[#7a3520\]" :reason="comment\.flagReason" :ai-verdict="comment\.aiVerdict" \/>/)
})

test('the hidden line of /admin/comments: "Đã ẩn — <reason>" as before, the verdict note under it', async () => {
  const html = await renderSfcTemplate(HIDDEN, { reason: 'AI kiểm duyệt chưa cấu hình — cần con người đối soát', aiVerdict: { verdict: 'violation', severity: 'critical', reason: 'x' } })
  assert.match(html, /<i class="fa-solid fa-eye-slash" aria-hidden="true"><\/i><span class="font-semibold">Đã ẩn<\/span><span class="text-ink-muted font-normal">— AI kiểm duyệt chưa cấu hình — cần con người đối soát<\/span>/)
  // Child components are not resolved by this renderer: the tag stands for the note (its binding is
  // pinned on the source above, its rendering on the note itself).
  assert.match(html, /<\/div><AdminQueueAiVerdictNote class="mt-1"><\/AdminQueueAiVerdictNote><\/div>$/)
  const noReason = (await renderSfcTemplate(HIDDEN, { reason: null, aiVerdict: null })).replace(/<!--.*?-->/g, '')
  assert.match(noReason, /Đã ẩn<\/span><\/div>/, 'no reason: no dash')
})
