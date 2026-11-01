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

const { cleanQueueAiVerdictReason, queueAiVerdictFromReply, readQueueAiVerdict, QUEUE_AI_VERDICT_REASON_MAX_LENGTH, QUEUE_AI_VERDICT_MAX_COMBINING_RUN } = await import('../shared/moderation-ai-verdict.ts')
const { queueAiVerdictLabel, queueAiVerdictSummary } = await import('../app/utils/queue-ai-verdict.ts')
const { formatTimeDayVN } = await import('../app/utils/formatDate.ts')

const NOTE = new URL('../app/components/admin/QueueAiVerdictNote.vue', import.meta.url).pathname
const HIDDEN = new URL('../app/components/admin/CommentHiddenNote.vue', import.meta.url).pathname
const PANEL = new URL('../app/components/admin/ai/moderation/ModerationQueuePanel.vue', import.meta.url).pathname
const PAGE = new URL('../app/pages/admin/comments/index.vue', import.meta.url).pathname

/** SSR output without Vue's fragment markers (`<!--[-->`), so assertions read the text as shown. */
const renderNote = async (verdict: unknown) => (await renderSfcTemplate(NOTE, { verdict, queueAiVerdictLabel, queueAiVerdictSummary })).replace(/<!--.*?-->/g, '')

/** Characters by code unit, so this source carries no invisible character itself (Trojan Source). */
const ch = (...units: number[]) => String.fromCharCode(...units)
/** Characters by code point (astral planes too) — same reason. */
const cp = (...points: number[]) => String.fromCodePoint(...points)

/** 02:38 on 1 November in Vietnam: the day differs from UTC's. */
const JUDGED_AT = new Date('2026-10-31T19:38:00.000Z')

test('only the AI\'s two verdicts are stored; an unknown severity is "high", a reason that is not a string is empty; `at` is when it was judged', () => {
  assert.equal(queueAiVerdictFromReply({ verdict: 'safe', severity: 'low', reason: 'ok' }, JUDGED_AT), null)
  assert.equal(queueAiVerdictFromReply({ verdict: 'VIOLATION', severity: 'high', reason: 'x' }, JUDGED_AT), null)
  assert.equal(queueAiVerdictFromReply({ verdict: undefined, severity: 'high', reason: 'x' }, JUDGED_AT), null)
  assert.deepEqual(queueAiVerdictFromReply({ verdict: 'spam', severity: 'critical', reason: ' a ' }, JUDGED_AT), { verdict: 'spam', severity: 'critical', reason: 'a', at: '2026-10-31T19:38:00.000Z' })
  assert.deepEqual(queueAiVerdictFromReply({ verdict: 'violation', severity: 'extreme', reason: 42 }, JUDGED_AT), { verdict: 'violation', severity: 'high', reason: '', at: '2026-10-31T19:38:00.000Z' })
  const before = Date.now()
  const now = Date.parse(queueAiVerdictFromReply({ verdict: 'spam', severity: 'low', reason: '' })!.at!)
  assert.ok(now >= before && now <= Date.now(), 'without a clock: now')
})

test('invisible code points that are not format characters are removed too: Hangul fillers, braille blank, private use (every plane), variation selectors, the grapheme joiner, noncharacters, tags', () => {
  const invisible = [0x115f, 0x1160, 0x3164, 0xffa0, 0x2800, 0xe000, 0xf8ff, 0xf0000, 0x10fffd, 0xfe00, 0xfe0f, 0xe0100, 0xe01ef, 0x034f, 0xfdd0, 0xfffe, 0xffff, 0x1fffe, 0xe0041, 0xe007f]
  for (const point of invisible) {
    assert.equal(cleanQueueAiVerdictReason(`Lý${cp(point)}do`), 'Lýdo', `U+${point.toString(16)} left in`)
  }
  // A reason made only of them is no reason — not a blank-looking one.
  assert.equal(cleanQueueAiVerdictReason(invisible.map(point => cp(point)).join(' ')), '')
  // Format characters that are NOT default-ignorable (most `Cf` is both, so only these show that
  // `Cf` itself is still in the set): interlinear annotation anchors (they hide the annotated text),
  // Egyptian hieroglyph format controls, Arabic prepended marks.
  for (const point of [0xfff9, 0xfffa, 0xfffb, 0x13430, 0x1343f, 0x0600, 0x110bd]) {
    assert.equal(cleanQueueAiVerdictReason(`Lý${cp(point)}do`), 'Lýdo', `U+${point.toString(16)} left in`)
  }
  // The verifier's S8 line, end to end through what is stored.
  const s8 = `A${cp(0x3164)}B${cp(0x2800)}C${cp(0x0336).repeat(30)}D${cp(0xe000)}E${cp(0xfe0f)}F${cp(0xe0041)}G`
  assert.equal(queueAiVerdictFromReply({ verdict: 'violation', severity: 'high', reason: s8 }, JUDGED_AT)!.reason, `ABC${cp(0x0336, 0x0336)}DEFG`)
  // Visible text stays: an emoji whose selector is dropped keeps its picture; CJK, Thai, arrows, the replacement character.
  assert.equal(cleanQueueAiVerdictReason(`${cp(0x2764, 0xfe0f)} 中文 ไทย → ${cp(0xfffd)}`), `${cp(0x2764)} 中文 ไทย → ${cp(0xfffd)}`)
})

test('a pile of combining marks ("Zalgo") keeps two per letter — also when invisible characters or tags are woven between the marks', () => {
  const longestRun = (text: string) => Math.max(0, ...(text.match(/\p{M}+/gu) ?? []).map(run => Array.from(run).length))
  assert.equal(QUEUE_AI_VERDICT_MAX_COMBINING_RUN, 2)
  assert.equal(cleanQueueAiVerdictReason(`Z${cp(0x0336).repeat(40)}a${cp(0x0300, 0x0301, 0x0302, 0x0303)}l`), `Z${cp(0x0336, 0x0336)}a${cp(0x0300, 0x0301)}l`)
  for (const between of [0x200b, 0x2060, 0xfeff, 0xe0020, 0x034f, 0xfe0f, 0x3164, 0x2800, 0xe000]) {
    const woven = `x${`${cp(0x0489)}${cp(between)}`.repeat(25)}y`
    const cleaned = cleanQueueAiVerdictReason(woven)
    assert.equal(cleaned, `x${cp(0x0489, 0x0489)}y`, `marks woven with U+${between.toString(16)}`)
    assert.ok(longestRun(cleaned) <= QUEUE_AI_VERDICT_MAX_COMBINING_RUN)
  }
  // Marks on spaces and around control characters: still at most two on any one base.
  const spaced = Array.from({ length: 20 }, () => ` ${cp(0x0336).repeat(5)}${ch(0)}${cp(0x0336).repeat(5)}`).join('')
  assert.ok(longestRun(cleanQueueAiVerdictReason(`a${spaced}b`)) <= QUEUE_AI_VERDICT_MAX_COMBINING_RUN)
})

/** A real reason, long, every Vietnamese tone and vowel mark; the source holds it composed (NFC). */
const VIETNAMESE = 'Bình luận cổ súy tư tưởng cực đoan, xuyên tạc đường lối, xúc phạm cán bộ thi hành án, kêu gọi tụ tập trái phép; lặp lại luận điệu đã bị bác bỏ, dẫn link giả mạo để lừa đảo — đề nghị ẩn ngay.'

test('Vietnamese with its marks comes out as it went in — composed (NFC) or decomposed (NFD, two marks on ệ/ợ/ặ/ữ), nothing normalised, nothing dropped', () => {
  const nfd = VIETNAMESE.normalize('NFD')
  assert.ok(Array.from(nfd).length <= QUEUE_AI_VERDICT_REASON_MAX_LENGTH && nfd.length > VIETNAMESE.length, 'precondition: NFD differs, still under the limit')
  assert.ok(/\p{M}{2}/u.test(nfd), 'precondition: letters with two marks')
  assert.equal(cleanQueueAiVerdictReason(VIETNAMESE), VIETNAMESE)
  assert.equal(cleanQueueAiVerdictReason(nfd), nfd)
  // Old keyboards: a composed vowel plus a combining tone mark — one mark, kept.
  const mixed = `vi${cp(0x00ea, 0x0323)}t nam`
  assert.equal(cleanQueueAiVerdictReason(mixed), mixed)
})

test('a cut inside a decomposed letter drops the whole letter, never only its last mark — every letter kept has all its marks', () => {
  const ee = 'ệ'.normalize('NFD') // e, dot below, circumflex
  assert.equal(cleanQueueAiVerdictReason(`${'a'.repeat(QUEUE_AI_VERDICT_REASON_MAX_LENGTH - 2)}${ee}xyz`), `${'a'.repeat(QUEUE_AI_VERDICT_REASON_MAX_LENGTH - 2)}…`)
  // Long decomposed Vietnamese, the cut tried at 40 offsets (nine land inside a letter, three of
  // them between its two marks): what is kept (before "…") is the text's own beginning, and the
  // code point after it is never a mark.
  const long = `${VIETNAMESE} ${VIETNAMESE}`.normalize('NFD')
  for (let pad = 0; pad < 40; pad++) {
    const text = `${'a'.repeat(pad)}${long}`
    const cut = cleanQueueAiVerdictReason(text)
    assert.ok(cut.endsWith('…') && Array.from(cut).length <= QUEUE_AI_VERDICT_REASON_MAX_LENGTH)
    const kept = cut.slice(0, -1)
    const rest = text.slice(kept.length).replace(/^\s+/, '')
    assert.ok(text.startsWith(kept), `pad ${pad}`)
    assert.doesNotMatch(rest, /^\p{M}/u, `pad ${pad}: a mark was cut from its letter`)
  }
})

test('when it was judged reads in Vietnam time, whatever the zone of the machine', () => {
  const zone = process.env.TZ
  try {
    for (const tz of ['Asia/Ho_Chi_Minh', 'UTC', 'America/New_York']) {
      process.env.TZ = tz
      assert.equal(formatTimeDayVN('2026-10-31T19:38:00.000Z'), '02:38 01/11', tz)
      assert.equal(formatTimeDayVN('2026-10-31T17:00:00.000Z'), '00:00 01/11', tz)
      assert.equal(formatTimeDayVN(new Date('2026-10-31T16:59:00.000Z')), '23:59 31/10', tz)
    }
  } finally {
    if (zone === undefined) delete process.env.TZ
    else process.env.TZ = zone
  }
  for (const nothing of [null, undefined, '', 'không phải ngày']) assert.equal(formatTimeDayVN(nothing), '')
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

test('reading `at`: kept only as `toISOString` writes a real instant; anything else is dropped and the verdict still reads', () => {
  const good = { verdict: 'violation', severity: 'high', reason: 'x', at: '2026-10-31T19:38:00.000Z' }
  assert.deepEqual(readQueueAiVerdict(good), good)
  assert.deepEqual(readQueueAiVerdict(JSON.stringify(good)), good)
  for (const at of ['2026-02-31T00:00:00.000Z', '2026-10-31T19:38:00Z', '2026-10-31 19:38:00', '2026-10-31T19:38:00.000+07:00', ' 2026-10-31T19:38:00.000Z', '', 1761939480000, null, {}]) {
    assert.deepEqual(readQueueAiVerdict({ ...good, at }), { verdict: 'violation', severity: 'high', reason: 'x' }, JSON.stringify(at))
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

test('the label says when the AI judged (Vietnam time) when the verdict carries it; a verdict from before the field reads as before', async () => {
  const at = '2026-10-31T19:38:00.000Z'
  assert.equal(queueAiVerdictLabel({ verdict: 'spam', severity: 'low', reason: '', at }), 'AI kiểm duyệt tự động đánh giá lúc 02:38 01/11:')
  assert.equal(queueAiVerdictLabel({ verdict: 'spam', severity: 'low', reason: '' }), 'AI kiểm duyệt tự động đánh giá:')
  const html = await renderNote({ verdict: 'violation', severity: 'critical', reason: 'Tuyên truyền', at })
  assert.match(html, /<span class="font-semibold text-danger-soft">AI kiểm duyệt tự động đánh giá lúc 02:38 01\/11:<\/span> Vi phạm, mức độ Nguy hiểm — Tuyên truyền/)
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
