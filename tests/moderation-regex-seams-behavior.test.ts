/**
 * Behaviour of `server/services/moderation-regex.ts` (wave3-long-term 4.3, D-SPLIT).
 *
 * Written BEFORE the 686-line file was split, and green on it (597af6a): it must stay
 * green, unchanged, on the barrel + `moderation-regex-*.ts` parts. Everything goes
 * through the barrel path — the one path the two rule endpoints, `moderation-rules-cache`
 * and the two moderation passes import.
 *
 * `moderation-regex.test.ts` already pins the pattern tables. This file pins what a split
 * breaks without a type error, and the exact edges nothing else pins:
 *   - the runtime export list and the seven constants, exactly;
 *   - save time (Layer 1): the reason AND hint for each kind of rejected shape, the
 *     boundaries of `BOUNDED_CHOICES_LIMIT` and `SEQUENCE_COST_LIMIT`, backreferences,
 *     lookarounds, named and flag groups, and the error texts shown to staff;
 *   - flags: checked and compiled with `iu`, never lower-cased;
 *   - the compile cache: trimmed pattern, one warning per pattern per cache generation,
 *     cleared when full, cleared by `invalidateModerationRulesCache`;
 *   - run time (Layer 2): the exact windows scanned, the 200 ms window budget and the
 *     10-minute cool-down at their boundaries, the 1 s per-text budget, the log fields,
 *     and the per-window consequences the header documents (`$` per window, a long match
 *     on a boundary missed);
 *   - three Layer-1 gaps found while writing this file, pinned as they behave today
 *     (`FINDING …`): fixing one flips its test, in its own change.
 *
 * Timing is a fake clock (`setModerationRegexTimingForTests`) and the regexes timed are
 * fakes: no assertion depends on how fast this machine is, and no slow pattern ever runs.
 */
import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import * as moderationRegex from '../server/services/moderation-regex.ts'
import {
  MODERATION_PATTERN_MAX_LENGTH,
  MODERATION_REGEX_FLAGS,
  MODERATION_REGEX_WINDOW,
  MODERATION_REGEX_WINDOW_OVERLAP,
  MODERATION_RULE_CALL_BUDGET_MS,
  MODERATION_RULE_COOLDOWN_MS,
  MODERATION_RULE_WINDOW_BUDGET_MS,
  checkModerationPattern,
  clearCompiledModerationRegexCache,
  compileModerationRegex,
  findCatastrophicShape,
  isModerationRuleDisabled,
  isRegexRuleType,
  resetSlowModerationRules,
  setModerationRegexTimingForTests,
  testModerationRegex,
} from '../server/services/moderation-regex.ts'

type LogLine = Record<string, unknown>

/** Capture the JSON log lines (`logWarn` writes them to `console.error`) while `run` runs. */
async function captureLogs(run: () => void | Promise<void>): Promise<LogLine[]> {
  const lines: LogLine[] = []
  const spy = mock.method(console, 'error', (line: unknown) => {
    try {
      lines.push(JSON.parse(String(line)) as LogLine)
    } catch { /* not a log line */ }
  })
  try {
    await run()
  } finally {
    spy.mock.restore()
  }
  return lines
}

const events = (lines: LogLine[], event: string) => lines.filter(line => line.event === event)

const reasonOf = (pattern: string) => {
  const check = checkModerationPattern(pattern, 'pattern')
  assert.equal(check.ok, false, `must refuse: ${pattern}`)
  return (check as { ok: false; reason: string }).reason
}

// ── Surface ─────────────────────────────────────────────────────────────────

test('the barrel exports exactly the 16 runtime values it had before the split', () => {
  assert.deepEqual(Object.keys(moderationRegex).sort(), [
    'MODERATION_PATTERN_MAX_LENGTH',
    'MODERATION_REGEX_FLAGS',
    'MODERATION_REGEX_WINDOW',
    'MODERATION_REGEX_WINDOW_OVERLAP',
    'MODERATION_RULE_CALL_BUDGET_MS',
    'MODERATION_RULE_COOLDOWN_MS',
    'MODERATION_RULE_WINDOW_BUDGET_MS',
    'checkModerationPattern',
    'clearCompiledModerationRegexCache',
    'compileModerationRegex',
    'findCatastrophicShape',
    'isModerationRuleDisabled',
    'isRegexRuleType',
    'resetSlowModerationRules',
    'setModerationRegexTimingForTests',
    'testModerationRegex',
  ])
})

test('the seven limits keep their values (200 chars, iu, 2000/400-char windows, 200 ms, 1 s, 10 min)', () => {
  assert.equal(MODERATION_PATTERN_MAX_LENGTH, 200)
  assert.equal(MODERATION_REGEX_FLAGS, 'iu')
  assert.equal(MODERATION_REGEX_WINDOW, 2000)
  assert.equal(MODERATION_REGEX_WINDOW_OVERLAP, 400)
  assert.equal(MODERATION_RULE_WINDOW_BUDGET_MS, 200)
  assert.equal(MODERATION_RULE_CALL_BUDGET_MS, 1000)
  assert.equal(MODERATION_RULE_COOLDOWN_MS, 600_000)
})

// ── Lớp 1: lúc lưu ──────────────────────────────────────────────────────────

const NESTED = {
  reason: 'lượng từ lồng nhau, vd. (a+)+',
  hint: 'Hãy viết lại không lồng lượng từ, vd. \\w+ thay cho (\\w+)+.',
}
const OVERLAPPING_ALTERNATION = {
  reason: 'nhánh chọn bị lặp có thể khớp cùng một chỗ, vd. (a|ab)* hay (\\s|,)+',
  hint: 'Gộp các nhánh một ký tự vào một lớp ký tự như [\\s,]+, hoặc dùng các nhánh là từ cố định mà không từ nào là phần đầu của từ khác, như (đéo|địt|đụ)+.',
}
const EMPTY_LOOP = {
  reason: 'phần bị lặp có thể khớp chuỗi rỗng, vd. (a|)* hay (a?)*',
  hint: 'Bỏ nhánh rỗng / lượng từ ? bên trong phần lặp, vd. a* thay cho (a?)*.',
}
const BOUNDED_BLOWUP = {
  reason: 'phần lặp có giới hạn nhưng quá nhiều cách khớp, vd. (a?b?){20}',
  hint: 'Giảm số lần lặp hoặc bớt phần tuỳ chọn bên trong.',
}
const ADJACENT = {
  reason: 'các lượng từ nối nhau cùng khớp một loại ký tự, vd. \\s*\\s* hay .*a.*b',
  hint: 'Gộp lượng từ kề nhau thành một (\\s* thay cho \\s*\\s*), và giữa các từ dùng giới hạn cụ thể như .{0,30} thay cho .* / .+.',
}

const SHAPES: Array<[string, { reason: string; hint: string }, string[]]> = [
  ['nested quantifiers', NESTED, ['(a+)+', '(?:a+){2,}', '((ab)+)+', '(\\w+\\s?)+$', '(.*a){10}', '(?<g>a+)+']],
  ['overlapping alternation', OVERLAPPING_ALTERNATION, ['(a|ab)*', '(a|a)*', '(\\s|,)+', '((a|aa))+$', '(s|s)+x', '(?:đ|đa)+']],
  ['a loop that can match empty', EMPTY_LOOP, ['(a|)*', '(a?)*', '(x|)*', '(a*)*', '(a)\\1*', '(\\w)\\1+']],
  ['a bounded loop with too many ways', BOUNDED_BLOWUP, ['(a?b?){20}', '(a?){11}', '(a|b|ab){7}']],
  ['adjacent quantifiers', ADJACENT, ['\\s*\\s*$', '.*a.*b', '\\w+.{0,20}x', '(\\w+)\\1+', '(\\w+)\\1', '\\w+.{0,2}x', 'a?'.repeat(13)]],
]

test('save time: each rejected shape gives its own reason and rewrite hint, verbatim', () => {
  for (const [label, finding, patterns] of SHAPES) {
    for (const pattern of patterns) {
      assert.equal(findCatastrophicShape(pattern), finding.reason, `${label}: ${pattern}`)
      assert.deepEqual(
        checkModerationPattern(pattern, 'pattern'),
        { ok: false, reason: `Mẫu regex có nguy cơ treo máy chủ (${finding.reason}). ${finding.hint}` },
        `${label}: ${pattern}`,
      )
    }
  }
})

test('save time: the two cost limits sit exactly where they are documented', () => {
  // BOUNDED_CHOICES_LIMIT = 1024 ways: 2^10 passes, 2^11 does not.
  assert.equal(findCatastrophicShape('(a?){10}'), null)
  assert.equal(findCatastrophicShape('(a?){11}'), BOUNDED_BLOWUP.reason)
  // SEQUENCE_COST_LIMIT = 1e7 steps over a 2000-char window: 2000 × 2000 × 2 passes,
  // 2000 × 2000 × 3 does not; 2000 × 2^12 passes, 2000 × 2^13 does not.
  assert.equal(findCatastrophicShape('\\w+.{0,1}x'), null)
  assert.equal(findCatastrophicShape('\\w+.{0,2}x'), ADJACENT.reason)
  assert.equal(findCatastrophicShape('a?'.repeat(12)), null)
  assert.equal(findCatastrophicShape('a?'.repeat(13)), ADJACENT.reason)
  // Exactly at the limit is allowed: 2000 × 5 × 1000 = 1e7; one more way is not.
  assert.equal(findCatastrophicShape('.{0,4}.{0,999}'), null)
  assert.equal(findCatastrophicShape('.{0,4}.{0,1000}'), ADJACENT.reason)
  // One unbounded quantifier on its own is fine; a second one next to it is not.
  assert.equal(findCatastrophicShape('\\s+'), null)
  assert.equal(findCatastrophicShape('\\s+\\s+'), ADJACENT.reason)
  // A required character outside the first quantifier's class separates two of them.
  assert.equal(findCatastrophicShape('\\d+x\\d+'), null)
  assert.equal(findCatastrophicShape('\\w+x\\w+'), ADJACENT.reason)
})

test('save time: backreferences — a single one passes, repeated or next to a quantifier it does not', () => {
  for (const pattern of ['(a)\\1', '(?<g>a)\\k<g>', '(ab)\\1c', '(\\d)-\\1'])
    assert.deepEqual(checkModerationPattern(pattern, 'pattern'), { ok: true }, pattern)
  assert.equal(findCatastrophicShape('(\\w+)\\1'), ADJACENT.reason)
  assert.equal(findCatastrophicShape('(\\w+)\\1+$'), ADJACENT.reason)
  assert.equal(findCatastrophicShape('(?<w>\\w+)\\k<w>+'), ADJACENT.reason)
  assert.equal(findCatastrophicShape('(a)\\1*'), EMPTY_LOOP.reason)
})

test('save time: lookarounds, anchors, named, flag and lazy groups, escapes are parsed — not refused for their syntax', () => {
  for (const pattern of [
    '(?<=a)b+',
    '(?<!x)y',
    '(?=a)a+',
    '(?!x)\\w+',
    '\\bcấm\\b',
    '\\Bx\\B',
    '^\\d+$',
    '(?<tu>cờ|cá)\\s+bạc',
    'a+?b',
    '(foo|bar){2,3}?',
    '\\p{L}+',
    '\\P{N}+',
    '\\u{1F600}+',
    '\\u0041+',
    '\\x41+',
    '\\cJ+',
    '[^]',
    '[]a',
    '[\\]a]+',
    '\\0',
  ])
    assert.deepEqual(checkModerationPattern(pattern, 'pattern'), { ok: true }, pattern)
  // The parser still looks inside them.
  assert.equal(findCatastrophicShape('(?=(a+)+)x'), NESTED.reason)
  assert.equal(findCatastrophicShape('(?i:(a|ab)+)'), OVERLAPPING_ALTERNATION.reason)
  assert.equal(findCatastrophicShape('(?<g>(a|ab)+)'), OVERLAPPING_ALTERNATION.reason)
  assert.equal(findCatastrophicShape('(a+?)+?'), NESTED.reason)
})

/** RegExp modifier groups `(?i:…)` ship in V8 12.5+ (Node 24 in CI); Node 22 (V8 12.4, still in `engines`) refuses them. */
const MODIFIERS_SUPPORTED = (() => {
  try {
    new RegExp('(?-i:a)', MODERATION_REGEX_FLAGS)
    return true
  } catch {
    return false
  }
})()

test('inline modifier groups (?i:…)/(?-i:…): parsed as plain groups; accepted where the engine has them, refused as invalid where it does not', () => {
  // The parser handles them whatever the engine (it never compiles the whole pattern).
  assert.equal(findCatastrophicShape('(?i:abc)\\d+'), null)
  assert.equal(findCatastrophicShape('(?i:(a|ab)+)'), OVERLAPPING_ALTERNATION.reason)
  if (MODIFIERS_SUPPORTED) {
    assert.deepEqual(checkModerationPattern('(?i:abc)\\d+', 'pattern'), { ok: true })
    assert.deepEqual(checkModerationPattern('(?-i:ABC)x', 'pattern'), { ok: true })
    clearCompiledModerationRegexCache()
    const sensitive = compileModerationRegex('(?-i:ABC)')!
    assert.equal(sensitive.test('ABC'), true)
    assert.equal(sensitive.test('abc'), false, 'an inline (?-i:…) group overrides the i flag')
  } else {
    assert.match(reasonOf('(?-i:ABC)x'), /^Mẫu regex không hợp lệ: Invalid regular expression: \/\(\?-i:ABC\)x\/iu: \S/)
    assert.equal(compileModerationRegex('(?-i:ABC)'), null)
  }
})

test('save time: escapes that name ONE character count as fixed words; class escapes do not', () => {
  // `\x61` is "a", `b` is "b": (a|b) words, prefix-free → passes; `\x61` vs "a" → same word.
  assert.equal(findCatastrophicShape('(\\x61|\\u0062)+'), null)
  assert.equal(findCatastrophicShape('(\\x61|a)+'), OVERLAPPING_ALTERNATION.reason)
  // Case folds through toLowerCase: "A" and "a" are the same word.
  assert.equal(findCatastrophicShape('(A|a)+'), OVERLAPPING_ALTERNATION.reason)
  assert.equal(findCatastrophicShape('(Đ|đa)+'), OVERLAPPING_ALTERNATION.reason)
  // `\d` is a class, never a word.
  assert.equal(findCatastrophicShape('(\\d|x)+'), OVERLAPPING_ALTERNATION.reason)
})

test('error texts: empty, too long, invalid with the runtime flags — shown to staff verbatim', () => {
  for (const blank of ['', '   ', '\n\t', null, undefined])
    assert.deepEqual(checkModerationPattern(blank as unknown as string, 'regex'), { ok: false, reason: 'Mẫu nhận diện không được để trống.' })
  const tooLong = { ok: false, reason: 'Mẫu nhận diện quá dài (tối đa 200 ký tự).' }
  assert.deepEqual(checkModerationPattern('a'.repeat(201), 'keyword'), tooLong)
  assert.deepEqual(checkModerationPattern('a'.repeat(201), 'regex'), tooLong)
  // Length is measured after trimming.
  assert.deepEqual(checkModerationPattern(`  ${'a'.repeat(200)}  `, 'regex'), { ok: true })
  // Invalid: the engine's message, compiled with exactly the runtime flags (`/…/iu`).
  for (const [pattern, detail] of [
    ['(', /^Invalid regular expression: \/\(\/iu: \S/],
    ['a{2,1}', /^Invalid regular expression: \/a\{2,1\}\/iu: \S/],
    // Valid without `u`, refused with it: the save check uses the same flags as the run.
    ['\\-', /^Invalid regular expression: \/\\-\/iu: \S/],
    ['\\p{Nope}', /^Invalid regular expression: \/\\p\{Nope\}\/iu: \S/],
  ] as const) {
    const reason = reasonOf(pattern)
    assert.ok(reason.startsWith('Mẫu regex không hợp lệ: '), reason)
    assert.match(reason.slice('Mẫu regex không hợp lệ: '.length), detail, pattern)
  }
  assert.doesNotThrow(() => new RegExp('\\-'), 'the `u` flag is what makes \\- invalid')
})

test('rule types: only exactly "keyword" skips the regex checks; anything else (null too) is a regex', () => {
  assert.equal(isRegexRuleType('keyword'), false)
  for (const type of ['pattern', 'regex', '', 'KEYWORD', 'Keyword', null, undefined]) assert.equal(isRegexRuleType(type), true, String(type))
  assert.deepEqual(checkModerationPattern('(a+)+', 'keyword'), { ok: true })
  assert.deepEqual(checkModerationPattern('(', 'keyword'), { ok: true })
  assert.equal(checkModerationPattern('(a+)+', null).ok, false)
  assert.equal(checkModerationPattern('(a+)+', 'KEYWORD').ok, false)
})

// ── Cờ và biên dịch ─────────────────────────────────────────────────────────

test('flags: compiled with iu — case-insensitive for Vietnamese, code points, \\p classes; never lower-cased', () => {
  clearCompiledModerationRegexCache()
  const upper = compileModerationRegex('ĐÉO')!
  assert.equal(upper.flags, 'iu')
  assert.equal(upper.source, 'ĐÉO', 'the source is kept as written')
  assert.equal(upper.test('đéo'), true)
  assert.equal(compileModerationRegex('^.$')!.test('😀'), true, 'u: one code point is one character')
  assert.equal(compileModerationRegex('^\\p{L}+$')!.test('Việt'), true)
  assert.equal(compileModerationRegex('^\\S+$')!.test('   '), false, '\\S stays non-space')
  assert.equal(compileModerationRegex('^\\W+$')!.test('abc'), false, '\\W stays non-word')
})

test('compile cache: trimmed pattern, keyed by the raw text, one warning per refused pattern per cache generation', async () => {
  clearCompiledModerationRegexCache()
  const padded = compileModerationRegex('  cấm\\d  ')!
  assert.equal(padded.source, 'cấm\\d')
  assert.notEqual(compileModerationRegex('cấm\\d'), padded, 'a different raw key is a different entry')
  assert.equal(compileModerationRegex('  cấm\\d  '), padded)

  const long = `(a+)+${'x'.repeat(250)}`
  const lines = await captureLogs(() => {
    assert.equal(compileModerationRegex('(a+)+'), null)
    assert.equal(compileModerationRegex('(a+)+'), null)
    assert.equal(compileModerationRegex('('), null)
    assert.equal(compileModerationRegex(long), null)
    clearCompiledModerationRegexCache()
    assert.equal(compileModerationRegex('(a+)+'), null)
  })
  const skipped = events(lines, 'ai_moderation.rule_pattern_skipped')
  assert.deepEqual(
    skipped.map(line => line.pattern),
    ['(a+)+', '(', long.slice(0, 200), '(a+)+'],
    'once per pattern until the cache is cleared; the logged pattern is cut to 200 chars',
  )
  assert.equal(skipped[0]!.reason, reasonOf('(a+)+'))
  assert.equal(skipped[1]!.reason, reasonOf('('))
  assert.equal(skipped[2]!.reason, 'Mẫu nhận diện quá dài (tối đa 200 ký tự).')
})

test('compile cache: holds at most 1000 patterns — the 1001st empties it', () => {
  clearCompiledModerationRegexCache()
  const first = compileModerationRegex('cap0')
  for (let i = 1; i < 1000; i += 1) compileModerationRegex(`cap${i}`)
  assert.equal(compileModerationRegex('cap0'), first, '1000 entries: still cached')
  compileModerationRegex('cap1000')
  const again = compileModerationRegex('cap0')
  assert.ok(again)
  assert.notEqual(again, first, 'the cache was emptied when the 1001st pattern came in')
})

test('invalidateModerationRulesCache (rules cache) empties the compile cache and re-enables slow rules', async () => {
  const { invalidateModerationRulesCache } = await import('../server/services/moderation-rules-cache.ts')
  const clock = { t: 0, now: 50_000 }
  setModerationRegexTimingForTests({ elapsed: () => clock.t, now: () => clock.now })
  try {
    resetSlowModerationRules()
    clearCompiledModerationRegexCache()
    const compiled = compileModerationRegex('chậm')!
    const slow = { test: () => { clock.t += MODERATION_RULE_WINDOW_BUDGET_MS + 1; return false } } as unknown as RegExp
    await captureLogs(() => { testModerationRegex('chậm', slow, 'x') })
    assert.equal(isModerationRuleDisabled('chậm'), true)
    invalidateModerationRulesCache()
    assert.equal(isModerationRuleDisabled('chậm'), false)
    assert.notEqual(compileModerationRegex('chậm'), compiled)
  } finally {
    setModerationRegexTimingForTests(null)
    resetSlowModerationRules()
  }
})

// ── Lớp 2: lúc chạy ─────────────────────────────────────────────────────────

/** A text whose every char is distinct, so a window's offset is its first char. */
const distinct = (length: number) => Array.from({ length }, (_, i) => String.fromCharCode(0x4e00 + i)).join('')
const offsetOf = (slice: string) => slice.charCodeAt(0) - 0x4e00

/** A fake regex that records each window it is run on and costs `cost` ms of fake clock. */
function recorder(clock: { t: number }, cost: number | ((call: number) => number), match: (slice: string, call: number) => boolean = () => false) {
  const windows: Array<{ from: number; length: number }> = []
  const regex = {
    test: (slice: string) => {
      const call = windows.length
      windows.push({ from: offsetOf(slice), length: slice.length })
      clock.t += typeof cost === 'number' ? cost : cost(call)
      return match(slice, call)
    },
  } as unknown as RegExp
  return { regex, windows }
}

async function withClock<T>(run: (clock: { t: number; now: number }) => T | Promise<T>): Promise<T> {
  const clock = { t: 0, now: 1_000_000 }
  setModerationRegexTimingForTests({ elapsed: () => clock.t, now: () => clock.now })
  resetSlowModerationRules()
  try {
    return await run(clock)
  } finally {
    setModerationRegexTimingForTests(null)
    resetSlowModerationRules()
  }
}

test('windows: 2000 chars each, 400 shared with the next, starting every 1600 — the last one reaches the end', async () => {
  await withClock((clock) => {
    const cases: Array<[number, Array<{ from: number; length: number }>]> = [
      [0, [{ from: Number.NaN, length: 0 }]],
      [1999, [{ from: 0, length: 1999 }]],
      [2000, [{ from: 0, length: 2000 }]],
      [2001, [{ from: 0, length: 2000 }, { from: 1600, length: 401 }]],
      [3600, [{ from: 0, length: 2000 }, { from: 1600, length: 2000 }]],
      [3601, [{ from: 0, length: 2000 }, { from: 1600, length: 2000 }, { from: 3200, length: 401 }]],
      [5000, [{ from: 0, length: 2000 }, { from: 1600, length: 2000 }, { from: 3200, length: 1800 }]],
    ]
    for (const [length, expected] of cases) {
      const { regex, windows } = recorder(clock, 1)
      assert.equal(testModerationRegex('w', regex, distinct(length)), false)
      assert.deepEqual(windows, expected, `text of ${length} chars`)
    }
  })
})

test('windows: the scan stops at the first window that matches', async () => {
  await withClock((clock) => {
    const text = distinct(6000)
    // Inside the shared 400 chars: the first window already sees it.
    const inOverlap = text.charAt(1800)
    const first = recorder(clock, 1, slice => slice.includes(inOverlap))
    assert.equal(testModerationRegex('w', first.regex, text), true)
    assert.deepEqual(first.windows.map(w => w.from), [0])
    const late = text.charAt(5500)
    const third = recorder(clock, 1, slice => slice.includes(late))
    assert.equal(testModerationRegex('w', third.regex, text), true)
    assert.deepEqual(third.windows.map(w => w.from), [0, 1600, 3200, 4800])
  })
})

test('windows (documented consequences): $ matches at the end of every window; a match longer than the overlap, across a boundary, is missed', () => {
  const dollar = /x$/iu
  const text = `${'a'.repeat(1999)}x${'y'.repeat(1000)}`
  assert.equal(dollar.test(text), false)
  assert.equal(testModerationRegex('x$', dollar, text), true, 'the first window ends right after the x')
  const long = /a{450}/iu
  const straddling = `${'b'.repeat(1599)}${'a'.repeat(450)}${'b'.repeat(2000)}`
  assert.equal(long.test(straddling), true)
  assert.equal(testModerationRegex('a{450}', long, straddling), false, 'no window holds all 450 chars')
})

test('slow window: over 200 ms disables the rule for 10 minutes (exactly), logs once, returns its own result, scans no further', async () => {
  await withClock(async (clock) => {
    const atBudget = recorder(clock, MODERATION_RULE_WINDOW_BUDGET_MS)
    testModerationRegex('đúng-ngưỡng', atBudget.regex, 'x')
    assert.equal(isModerationRuleDisabled('đúng-ngưỡng'), false, 'exactly 200 ms is within the budget')

    const pattern = `chậm${'p'.repeat(250)}`
    const text = distinct(6000)
    const late = text.charAt(5500)
    const slow = recorder(clock, 200.5, slice => slice.includes(late))
    const lines = await captureLogs(() => {
      assert.equal(testModerationRegex(pattern, slow.regex, text), false, 'the slow window had no match: false')
      assert.deepEqual(slow.windows.map(w => w.from), [0], 'no window after the slow one')
      const fast = recorder(clock, 1, () => true)
      assert.equal(testModerationRegex(pattern, fast.regex, text), false, 'disabled: not run at all')
      assert.equal(fast.windows.length, 0)
    })
    assert.deepEqual(events(lines, 'ai_moderation.rule_slow_disabled').map(({ event, pattern: p, elapsedMs, inputLength, disabledForMs }) => ({ event, p, elapsedMs, inputLength, disabledForMs })), [
      { event: 'ai_moderation.rule_slow_disabled', p: pattern.slice(0, 200), elapsedMs: 201, inputLength: 6000, disabledForMs: 600_000 },
    ])
    assert.equal(isModerationRuleDisabled('another rule'), false, 'per pattern')

    // A slow window that DID match still reports the match.
    const slowHit = recorder(clock, 300, () => true)
    await captureLogs(() => { assert.equal(testModerationRegex('chậm-mà-khớp', slowHit.regex, 'x'), true) })
    assert.equal(isModerationRuleDisabled('chậm-mà-khớp'), true)

    // Cool-down: disabled until now + 10 min, enabled again at that instant.
    clock.now += MODERATION_RULE_COOLDOWN_MS - 1
    assert.equal(isModerationRuleDisabled(pattern), true)
    clock.now += 1
    assert.equal(isModerationRuleDisabled(pattern), false)
    const back = recorder(clock, 1, () => true)
    assert.equal(testModerationRegex(pattern, back.regex, text), true, 're-enabled: runs again')

    // Slow again after the cool-down: disabled again, logged again.
    const again = await captureLogs(() => { testModerationRegex(pattern, recorder(clock, 201).regex, 'x') })
    assert.equal(events(again, 'ai_moderation.rule_slow_disabled').length, 1)
    assert.equal(isModerationRuleDisabled(pattern), true)
    resetSlowModerationRules()
    assert.equal(isModerationRuleDisabled(pattern), false, 'reset re-enables at once')
  })
})

test('per-text budget: past 1 s on one text the rest is not scanned (rule stays on), logged once per pattern per 10 minutes', async () => {
  await withClock(async (clock) => {
    const step = MODERATION_REGEX_WINDOW - MODERATION_REGEX_WINDOW_OVERLAP
    const text = distinct(step * 15)
    let windows: number[] = []
    const lines = await captureLogs(() => {
      // 100 ms per window: 1000 ms after 10 windows is not over the budget; 1100 after 11 is.
      const scan = recorder(clock, 100)
      assert.equal(testModerationRegex('dài', scan.regex, text), false)
      windows = scan.windows.map(w => w.from)
      testModerationRegex('dài', recorder(clock, 100).regex, text)
    })
    assert.equal(windows.length, 11)
    assert.equal(windows.at(-1), 10 * step)
    assert.equal(isModerationRuleDisabled('dài'), false, 'a long text is not the rule’s fault')
    assert.deepEqual(events(lines, 'ai_moderation.rule_scan_truncated').map(({ pattern, scannedChars, inputLength }) => ({ pattern, scannedChars, inputLength })), [
      { pattern: 'dài', scannedChars: 10 * step + 2000, inputLength: text.length },
    ], 'once, though the budget ran out twice')

    clock.now += MODERATION_RULE_COOLDOWN_MS
    const later = await captureLogs(() => { testModerationRegex('dài', recorder(clock, 100).regex, text) })
    assert.equal(events(later, 'ai_moderation.rule_scan_truncated').length, 1, 'logged again after the cool-down')
    resetSlowModerationRules()
    const afterReset = await captureLogs(() => { testModerationRegex('dài', recorder(clock, 100).regex, text) })
    assert.equal(events(afterReset, 'ai_moderation.rule_scan_truncated').length, 1, 'reset forgets the log memory too')
  })
})

test('the real clock comes back with setModerationRegexTimingForTests(null): a fast rule is not disabled', () => {
  setModerationRegexTimingForTests(null)
  resetSlowModerationRules()
  assert.equal(testModerationRegex('cấm', /cấm/iu, 'từ cấm ở đây'), true)
  assert.equal(isModerationRuleDisabled('cấm'), false)
})

// ── Phát hiện lúc viết test này — ghim đúng như hôm nay, sửa ở thay đổi riêng ──
//
// Ba mẫu dưới đây có cùng hình dạng với một mẫu lớp 1 ĐANG từ chối, nhưng lọt. Đo trên
// máy phát triển (Node 26, bản gốc 597af6a): mẫu 1 và 2 tốn 148 ms cho 401 ký tự (bậc ba
// — ~18 s cho một cửa sổ 2000 ký tự); mẫu 3 tốn 2,4 s cho 24 ký tự (cấp số — mỗi ký tự
// thêm nhân đôi). Lớp 2 tắt luật SAU cửa sổ chậm đầu tiên, nên cửa sổ đó vẫn chặn vòng
// sự kiện trọn thời gian của nó. Cần quyền sửa luật kiểm duyệt để lưu một mẫu như vậy.
// Sửa một lỗi thì test của nó đỏ — đổi khẳng định thành "bị từ chối" trong cùng thay đổi.

test('FINDING moderation-regex-1: nhóm có tên không phải ASCII bị phân tích sai — (?<é>\\s*)(?<ê>\\s*)$ lọt lớp 1', () => {
  // `Parser.group` chỉ nhận tên `[A-Za-z_$][\w$]*`; `(?<é>` rơi xuống nhánh `(?:`, bỏ 2 ký
  // tự `?<` và đọc `é>` thành chữ cố định — hai `\s*` trông như bị chữ đó ngăn cách.
  assert.equal(findCatastrophicShape('\\s*\\s*$'), ADJACENT.reason)
  assert.equal(findCatastrophicShape('(?<e>\\s*)(?<f>\\s*)$'), ADJACENT.reason, 'ASCII names: refused')
  assert.equal(findCatastrophicShape('(?<é>\\s*)(?<ê>\\s*)$'), null)
  assert.deepEqual(checkModerationPattern('(?<é>\\s*)(?<ê>\\s*)$', 'pattern'), { ok: true })
})

test('FINDING moderation-regex-2: {0} trên phần không giới hạn cho độ rộng NaN — (?:\\s+){0}\\s*\\s*$ lọt lớp 1', () => {
  // `width` của `(?:\s+){0}` là { min: 0, max: Infinity * 0 = NaN }; NaN đi vào tích chi phí
  // của cụm nối nhau và `NaN > SEQUENCE_COST_LIMIT` là false.
  assert.equal(findCatastrophicShape('(?:\\s+){1}\\s*\\s*$'), ADJACENT.reason, '{1}: refused')
  assert.equal(findCatastrophicShape('(?:\\s+){0}\\s*\\s*$'), null)
  assert.deepEqual(checkModerationPattern('(?:\\s+){0}\\s*\\s*$', 'pattern'), { ok: true })
})

test('FINDING moderation-regex-3: ký tự mà cờ iu gập về nhau nhưng toLowerCase thì không — (s|ſ)+x lọt lớp 1 (cấp số)', () => {
  // `literalStrings` hạ chữ bằng `toLowerCase()`; `ſ` (U+017F) không đổi, nên (s|ſ) trông
  // như hai từ khác nhau, không từ nào là phần đầu của từ kia. Với cờ `iu` cả hai nhánh
  // khớp cùng ký tự `s`.
  assert.equal(new RegExp('^ſ$', MODERATION_REGEX_FLAGS).test('s'), true, 'iu folds ſ to s')
  assert.equal(findCatastrophicShape('(s|s)+x'), OVERLAPPING_ALTERNATION.reason)
  assert.equal(findCatastrophicShape('(s|ſ)+x'), null)
  assert.deepEqual(checkModerationPattern('(s|ſ)+x', 'pattern'), { ok: true })
})
