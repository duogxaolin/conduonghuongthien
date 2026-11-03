/**
 * Layer 2 of `server/services/moderation-regex.ts` is a HARD bound: a rule's window is
 * interrupted once it has run `MODERATION_RULE_WINDOW_BUDGET_MS`, not measured after it ends.
 *
 * Why (verify of wave3 4.3b, FINDING moderation-regex-4): the save-time check (Layer 1) only
 * sees overlap on the 321 characters of its sample table, so `日*日*日*$` is accepted — and
 * on production main too. Run on `'日' × 400 + '!'` it took 15.6 s (first run; ~1.2 s once V8
 * has compiled the regex); `日*日*日*日*$` on 201 characters 42 s; `.*日.*日.*日$` on 401 more
 * than 60 s (Node 26, verifier's measurements). k adjacent quantifiers: degree k + 1.
 * Layer 2 used to disable a rule only AFTER its slow window finished, so one anonymous chatbot
 * message blocked the event loop for that long. Sound save-time analysis is impossible in
 * general (any character outside the table, any `\p{…}` class), so Layer 2 is the guarantee.
 *
 * Real patterns, real clock. Every call is wrapped in `withinWallClock` (a second, outer `vm`
 * bound): on code without the hard timeout these tests fail in seconds with a message instead
 * of holding the runner for minutes.
 */
import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import vm from 'node:vm'
import {
  MODERATION_RULE_COOLDOWN_MS,
  MODERATION_RULE_WINDOW_BUDGET_MS,
  checkModerationPattern,
  clearCompiledModerationRegexCache,
  compileModerationRegex,
  isModerationRuleDisabled,
  resetSlowModerationRules,
  setModerationRegexTimingForTests,
  testModerationRegex,
  testModerationRegexes,
} from '../server/services/moderation-regex.ts'
import { withinWallClock } from './_wall-clock-bound.ts'

type LogLine = Record<string, unknown>

/** Capture the JSON log lines (`logWarn` writes them to `console.error`) while `run` runs. */
function captureLogs<T>(run: () => T): { value: T, lines: LogLine[] } {
  const lines: LogLine[] = []
  const spy = mock.method(console, 'error', (line: unknown) => {
    try {
      lines.push(JSON.parse(String(line)) as LogLine)
    } catch { /* not a log line */ }
  })
  try {
    return { value: run(), lines }
  } finally {
    spy.mock.restore()
  }
}

/** The outer bound: far above the hard timeout, far below what the patterns cost unbounded. */
const OUTER_BOUND_MS = 5000

/**
 * Run one rule on one text through the barrel, timed on the wall clock. `vmPasses`: how many
 * bounded passes the runtime made (its `runInContext` calls with the window budget as timeout) —
 * 0 for a disabled rule, whatever the machine's load, where a wall-time check could flake.
 */
function timedRun(pattern: string, text: string) {
  const regex = compileModerationRegex(pattern)
  assert.ok(regex, `Layer 1 accepts ${pattern} (best effort — the runtime bound is the guarantee)`)
  const spy = mock.method(vm.Script.prototype, 'runInContext')
  const started = performance.now()
  try {
    const { value: matched, lines } = captureLogs(() => withinWallClock(OUTER_BOUND_MS, pattern, () => testModerationRegex(pattern, regex, text)))
    const vmPasses = spy.mock.calls.filter(call => call.arguments[1]?.timeout === MODERATION_RULE_WINDOW_BUDGET_MS).length
    return { matched, wallMs: performance.now() - started, lines, regex, vmPasses }
  } finally {
    spy.mock.restore()
  }
}

function fresh(): void {
  setModerationRegexTimingForTests(null)
  resetSlowModerationRules()
  clearCompiledModerationRegexCache()
}

test('hard timeout: 日*日*日*$ passes Layer 1, and on 401 chars returns within ~1 s, disables the rule, logs once; the next call is instant', () => {
  fresh()
  try {
    const pattern = '日*日*日*$'
    const text = `${'日'.repeat(400)}!`
    assert.deepEqual(checkModerationPattern(pattern, 'pattern'), { ok: true }, 'Layer 1 still accepts it (FINDING moderation-regex-4)')

    const first = timedRun(pattern, text)
    assert.ok(first.wallMs < 1000, `bounded: ${first.wallMs.toFixed(0)} ms (unbounded it ran ~15.6 s on its first run)`)
    assert.equal(first.vmPasses, 1, 'one bounded pass: cut off, blamed, nothing left to scan')
    assert.equal(first.matched, false, 'interrupted: the window counts as no match (fail-open, as before for a skipped rule)')
    assert.equal(isModerationRuleDisabled(pattern), true, 'the offender is disabled')
    const logged = first.lines.filter(line => line.event === 'ai_moderation.rule_slow_disabled')
    assert.equal(logged.length, 1, 'logged once, through the existing event')
    assert.equal(logged[0]!.pattern, pattern)
    assert.equal(logged[0]!.inputLength, text.length)
    assert.equal(logged[0]!.disabledForMs, MODERATION_RULE_COOLDOWN_MS)
    assert.ok(Number(logged[0]!.elapsedMs) >= MODERATION_RULE_WINDOW_BUDGET_MS - 1 && Number(logged[0]!.elapsedMs) < 1000,
      `elapsedMs ${String(logged[0]!.elapsedMs)}: about the budget, not the unbounded run`)

    const second = timedRun(pattern, text)
    assert.equal(second.vmPasses, 0, `disabled: not run again (${second.wallMs.toFixed(2)} ms)`)
    assert.equal(second.matched, false)
    assert.equal(second.lines.length, 0, 'no second log line')
  } finally {
    fresh()
  }
})

/**
 * The verifier's FINDING-4 class — every one accepted by Layer 1 on this code and on main —
 * with the unbounded cost it measured (Node 26), or the order of it.
 */
const ATTACKS: Array<[pattern: string, text: string, unbounded: string]> = [
  ['日*日*日*$', `${'日'.repeat(400)}!`, '15.6 s'],
  ['日*日*日*日*$', `${'日'.repeat(200)}!`, '42.6 s'],
  ['.*日.*日.*日$', `${'日'.repeat(400)}!`, '> 60 s'],
  ['\\p{Script=Cyrillic}*\\p{Script=Cyrillic}*\\p{Script=Cyrillic}*$', `${'ж'.repeat(400)}!`, '38.1 s'],
  ['ж*ж*ж*ж*ж*$', `${'ж'.repeat(400)}!`, 'five quantifiers, degree 6: minutes'],
  ['[а-я]*[а-я]*[а-я]*$', `${'ж'.repeat(400)}!`, 'degree 4, as 日*日*日*$'],
  ['[а-я]*[а-я]*$', `${'ж'.repeat(1999)}!`, '~1.2 s (degree 3, as \\s*\\s*$, one window)'],
  ['₫*₫*$', `${'₫'.repeat(1999)}!`, '1.2 s'],
  ['(?:ж|з)*ж*$', `${'ж'.repeat(1999)}!`, '1.2 s'],
]

test('hard timeout: the verifier’s attack patterns each return in < 1.5 s wall and are disabled (Layer 1 accepts every one)', () => {
  fresh()
  try {
    const report: string[] = []
    for (const [pattern, text, unbounded] of ATTACKS) {
      assert.deepEqual(checkModerationPattern(pattern, 'pattern'), { ok: true }, `Layer 1 accepts ${pattern}`)
      const run = timedRun(pattern, text)
      report.push(`${pattern} on ${text.length} chars: ${run.wallMs.toFixed(0)} ms (unbounded ${unbounded})`)
      assert.ok(run.wallMs < 1500, report.at(-1))
      assert.equal(isModerationRuleDisabled(pattern), true, `${pattern} is disabled`)
      assert.equal(run.lines.filter(line => line.event === 'ai_moderation.rule_slow_disabled').length, 1, `${pattern}: logged once`)
      assert.equal(run.vmPasses, 1, `${pattern}: one bounded pass`)
      const again = timedRun(pattern, text)
      assert.equal(again.vmPasses, 0, `${pattern}: the second call does not run it (${again.wallMs.toFixed(2)} ms)`)
    }
  } finally {
    fresh()
  }
})

test('hard timeout: a disabled rule comes back after the cool-down and is bounded again', () => {
  fresh()
  const clock = { now: 1_000_000 }
  setModerationRegexTimingForTests({ elapsed: () => performance.now(), now: () => clock.now })
  try {
    // Four quantifiers, degree 5: unbounded, minutes on 401 chars even once V8 has compiled the
    // regex to native code (日*日*日*$ drops from 15.6 s to ~1.2 s after its first run — too
    // close to the bound to tell the two codes apart).
    const pattern = 'ж*ж*ж*ж*$'
    const text = `${'ж'.repeat(400)}!`
    const first = timedRun(pattern, text)
    assert.ok(first.wallMs < 1500, `bounded: ${first.wallMs.toFixed(0)} ms`)
    assert.equal(isModerationRuleDisabled(pattern), true)
    clock.now += MODERATION_RULE_COOLDOWN_MS
    assert.equal(isModerationRuleDisabled(pattern), false, 'back on after 10 minutes')
    const back = timedRun(pattern, text)
    assert.ok(back.wallMs < 1500, `bounded again: ${back.wallMs.toFixed(0)} ms`)
    assert.equal(isModerationRuleDisabled(pattern), true, 'and disabled again')
    assert.equal(back.lines.filter(line => line.event === 'ai_moderation.rule_slow_disabled').length, 1)
  } finally {
    fresh()
  }
})

test('a fast rule is untouched by the bound: same results, nothing disabled, nothing logged', () => {
  fresh()
  try {
    for (const [pattern, text, expected] of [
      ['cờ[\\s,.]+bạc', `${'Bài viết hay. '.repeat(150)}chơi cờ, bạc ở đây`, true],
      ['\\b(tài|tai)\\s*xỉu\\b', 'Bài viết này rất hay, cảm ơn tác giả.', false],
      ['^\\D+$', 'không có chữ số', true],
    ] as const) {
      const run = timedRun(pattern, text)
      assert.equal(run.matched, expected, pattern)
      assert.equal(isModerationRuleDisabled(pattern), false, pattern)
      assert.deepEqual(run.lines, [], pattern)
    }
  } finally {
    fresh()
  }
})

// ── One bounded pass per text, for every rule (testModerationRegexes) ──────────

/** Busy-wait `ms` of real time — a fake rule that is slow, then answers `result`. */
const busyRule = (pattern: string, ms: number, result: boolean) => ({
  pattern,
  regex: { test: () => { const end = performance.now() + ms; while (performance.now() < end); return result } } as unknown as RegExp,
})

/** Count `runInContext` calls (on any script) and remember their `this`, context and options. */
function spyRunInContext() {
  return mock.method(vm.Script.prototype, 'runInContext')
}

const VIETNAMESE_RULES = [
  '(lừa đảo|chiếm đoạt|vay nặng lãi)', '\\b(cờ bạc|cá độ)\\b', 'cờ[\\s,.]+bạc', 'đ[ụu]\\s*m[áa]', 'ma.{0,20}túy',
  '(?:0|\\+84)\\d{9}', '(\\d[\\s.]?){9,10}', '(\\d{3,4}[\\s.-]?){2,3}', '\\p{L}+\\s+bậy', '(cờ|cá)\\s+(bạc|độ)+',
  '(https?://)?(www\\.)?(bet|casino)', '(fb88|w88|m88)+', '(đéo|địt|đụ)+', 'k[h]?ông\\s+(ai|người)\\s+(biết)?',
  '(mẹ|má) (mày|mi)', '(\\W|^)(ngu)(\\W|$)', '(\\s|^)ngu(\\s|$)', 'cờ.{0,30}bạc.{0,30}online', 'abc\\d+',
  '(foo|bar)+', 'ca\\s?độ', '[0-9]{9,11}', '\\b(tài|tai)\\s*xỉu\\b', '(?:đm|dm)+', '(ab|cd){2,5}', 'https?://\\S+',
  '(\\d{3})-(\\d{4})', 'lô\\s*đề', 'đánh\\s*bài\\s*online', 'nhà\\s*cái\\s*uy\\s*tín',
]
const compiledRules = (patterns: readonly string[]) => patterns.map(pattern => ({ pattern, regex: compileModerationRegex(pattern)! }))

test('one vm call per text for 30 rules over several windows: same context and script every time, timeout = the window budget', () => {
  fresh()
  // A pass that has run > 20 ms yields before its next window (4.3c follow-up). These 30 rules take
  // ~1–3 ms here, but a throttled runner (`--cpus 0.5`) can stall one pass past 20 ms: the clock is
  // frozen so the count below is about the pass structure, not the machine.
  setModerationRegexTimingForTests({ elapsed: () => 0, now: () => 1_000_000 })
  const rules = compiledRules(VIETNAMESE_RULES)
  assert.equal(rules.length, 30)
  assert.ok(rules.every(rule => rule.regex), 'all 30 pass Layer 1')
  const text = `${'Bài viết này rất hay, cảm ơn tác giả. '.repeat(120)}chơi cờ, bạc và lô đề`
  const spy = spyRunInContext()
  try {
    const first = testModerationRegexes(rules, text)
    const second = testModerationRegexes(rules, `${text} gọi 0912345678`)
    assert.equal(spy.mock.callCount(), 2, 'one vm call per text, not one per rule or per window')
    const [a, b] = spy.mock.calls
    assert.equal(a!.this, b!.this, 'the script is made once')
    assert.equal(a!.arguments[0], b!.arguments[0], 'the context is made once')
    for (const call of spy.mock.calls) assert.deepEqual(call.arguments[1], { timeout: MODERATION_RULE_WINDOW_BUDGET_MS })
    // Same answers as running each rule on its own, the old way.
    assert.deepEqual(first, rules.map(rule => testModerationRegex(rule.pattern, rule.regex, text)))
    assert.deepEqual(first.flatMap((hit, i) => (hit ? [rules[i]!.pattern] : [])), ['cờ[\\s,.]+bạc', 'lô\\s*đề'])
    assert.ok(second.filter(Boolean).length > first.filter(Boolean).length, 'the phone number rules fire on the second text')
  } finally {
    spy.mock.restore()
    fresh()
  }
})

// 4.3c follow-up (W1/S3): an innocent rule used to be cut off ~50 ms in — the pass's timer had
// started under the 150-ms rule before it — and then re-run (test() twice on one window). Now a
// pass that has run > 20 ms yields BEFORE the next window, so every window starts with ≥ 180 ms
// of its pass left: nothing is cut, nothing re-run.
test('attribution: an innocent rule after rules that used the time starts a fresh pass — never cut off, never re-run, never disabled', () => {
  fresh()
  const spy = spyRunInContext()
  try {
    const counted = (rule: ReturnType<typeof busyRule>) => {
      const calls = { n: 0 }
      return { calls, rule: { pattern: rule.pattern, regex: { test: (s: string) => { calls.n += 1; return rule.regex.test(s) } } as unknown as RegExp } }
    }
    const wrapped = [counted(busyRule('chậm-mà-hợp-lệ', 150, false)), counted(busyRule('vô-tội', 100, true)), counted(busyRule('sau-cùng', 0, true))]
    const rules = wrapped.map(w => w.rule)
    const started = performance.now()
    const { value: hits, lines } = captureLogs(() => withinWallClock(OUTER_BOUND_MS, 'attribution', () => testModerationRegexes(rules, 'x')))
    const wallMs = performance.now() - started
    assert.deepEqual(hits, [false, true, true], 'every rule gave its own answer')
    assert.deepEqual(wrapped.map(w => w.calls.n), [1, 1, 1], 'each window ran exactly once')
    for (const rule of rules) assert.equal(isModerationRuleDisabled(rule.pattern), false, `${rule.pattern} stays on`)
    assert.deepEqual(lines, [])
    // vm calls: one per rule here — 'vô-tội' and 'sau-cùng' each open a fresh pass.
    assert.equal(spy.mock.calls.filter(call => call.arguments[1]?.timeout === MODERATION_RULE_WINDOW_BUDGET_MS).length, 3)
    assert.ok(wallMs > 240 && wallMs < 1000, `150 + 100 ms, nothing wasted: ${wallMs.toFixed(0)} ms`)
  } finally {
    spy.mock.restore()
    fresh()
  }
})

test('progress: a window cut off as the FIRST step of its pass is the offender whatever the clock reads — never re-run forever', () => {
  // A clock that never moves reads every interrupted window as having run 0 ms. Blaming only
  // windows that "ran ≥ the budget" would then re-run the same window in pass after pass; the
  // first step of a pass had the whole timer to itself, so it is the offender by construction.
  fresh()
  setModerationRegexTimingForTests({ elapsed: () => 0, now: () => 1_000_000 })
  try {
    const pattern = '日*日*日*$'
    const started = performance.now()
    const { value: hit, lines } = captureLogs(() => withinWallClock(OUTER_BOUND_MS, 'frozen clock', () =>
      testModerationRegex(pattern, compileModerationRegex(pattern)!, `${'日'.repeat(400)}!`)))
    assert.equal(hit, false)
    assert.ok(performance.now() - started < 1000, 'one pass, cut off once')
    assert.equal(isModerationRuleDisabled(pattern), true)
    assert.deepEqual(lines.map(line => [line.event, line.interrupted]), [['ai_moderation.rule_slow_disabled', true]])
  } finally {
    fresh()
  }
})

test('a catastrophic rule among 30: only it is interrupted and disabled; every other rule, before and after it, answers as usual', () => {
  fresh()
  try {
    const bad = '日*日*日*$'
    const rules = compiledRules([...VIETNAMESE_RULES.slice(0, 15), bad, ...VIETNAMESE_RULES.slice(15)])
    const text = `cờ, bạc ${'日'.repeat(400)}! abc123`
    const expected = rules.map(rule => (rule.pattern === bad ? false : rule.regex.test(text)))
    assert.ok(expected.filter(Boolean).length >= 2, 'rules on both sides of it match')
    const started = performance.now()
    const { value: hits, lines } = captureLogs(() => withinWallClock(OUTER_BOUND_MS, '30 rules', () => testModerationRegexes(rules, text)))
    const wallMs = performance.now() - started
    assert.ok(wallMs < 1000, `bounded: ${wallMs.toFixed(0)} ms`)
    assert.deepEqual(hits, expected)
    assert.deepEqual(rules.filter(rule => isModerationRuleDisabled(rule.pattern)).map(rule => rule.pattern), [bad])
    assert.deepEqual(lines.map(line => [line.event, line.pattern, line.interrupted]), [['ai_moderation.rule_slow_disabled', bad, true]])
  } finally {
    fresh()
  }
})

test('stopAtFirstMatch: the rules after the first hit do not run (a catastrophic one there costs nothing); without it they do', () => {
  fresh()
  try {
    const bad = '日*日*日*$'
    const ran: string[] = []
    // The compiled regexes, each wrapped to record that it ran (and then run for real).
    const rules = compiledRules(['lô\\s*đề', 'cờ[\\s,.]+bạc', bad]).map(({ pattern, regex }) => ({
      pattern,
      regex: { test: (slice: string) => { ran.push(pattern); return regex.test(slice) } } as unknown as RegExp,
    }))
    const text = `cờ, bạc ${'日'.repeat(400)}!`
    assert.deepEqual(testModerationRegexes(rules, text, { stopAtFirstMatch: true }), [false, true, false])
    assert.deepEqual(ran, ['lô\\s*đề', 'cờ[\\s,.]+bạc'], 'the catastrophic rule after the hit never ran')
    assert.equal(isModerationRuleDisabled(bad), false)
    const started = performance.now()
    const { value: all } = captureLogs(() => withinWallClock(OUTER_BOUND_MS, 'all rules', () => testModerationRegexes(rules, text)))
    assert.deepEqual(all, [false, true, false])
    assert.ok(performance.now() - started < 1000)
    assert.equal(isModerationRuleDisabled(bad), true)
  } finally {
    fresh()
  }
})

test('two rules with the same pattern: once it is interrupted, the second is skipped as already disabled (one log line, one budget)', () => {
  fresh()
  try {
    const pattern = '日*日*日*$'
    const regex = compileModerationRegex(pattern)!
    const started = performance.now()
    const { value: hits, lines } = captureLogs(() => withinWallClock(OUTER_BOUND_MS, 'duplicates', () =>
      testModerationRegexes([{ pattern, regex }, { pattern, regex }], `${'日'.repeat(400)}!`)))
    assert.deepEqual(hits, [false, false])
    assert.ok(performance.now() - started < 1000)
    assert.equal(lines.filter(line => line.event === 'ai_moderation.rule_slow_disabled').length, 1)
  } finally {
    fresh()
  }
})

test('text and patterns reach the vm as data, never as script text: quotes, backticks and newlines change nothing', () => {
  fresh()
  try {
    const nasty = "'); throw new Error('injected'); ('` ${process.exit(1)} \n\"); //"
    const rules = compiledRules(["throw new Error\\('injected'\\)", '\\$\\{process\\.exit', 'không-có'])
    assert.deepEqual(testModerationRegexes(rules, nasty), [true, true, false])
    assert.deepEqual(testModerationRegexes([], nasty), [], 'no rules: nothing to run')
  } finally {
    fresh()
  }
})

test('an error that is not the timeout still comes out of the call; rules already scanned keep their consequences', () => {
  fresh()
  const clock = { t: 0 }
  setModerationRegexTimingForTests({ elapsed: () => clock.t, now: () => 1_000_000 })
  try {
    const slow = { pattern: 'chậm', regex: { test: () => { clock.t += MODERATION_RULE_WINDOW_BUDGET_MS + 1; return false } } as unknown as RegExp }
    const broken = { pattern: 'hỏng', regex: { test: () => { throw new Error('boom') } } as unknown as RegExp }
    const { lines } = captureLogs(() => assert.throws(() => testModerationRegexes([slow, broken], 'x'), /boom/))
    assert.equal(isModerationRuleDisabled('chậm'), true, 'the slow rule before the error is still disabled')
    assert.equal(lines.filter(line => line.event === 'ai_moderation.rule_slow_disabled').length, 1)
  } finally {
    fresh()
  }
})

test('lastIndex is left exactly as a direct test() leaves it (the runtime neither resets nor restores it)', () => {
  fresh()
  try {
    const viaRuntime = /x/giu
    const direct = /x/giu
    assert.equal(testModerationRegex('x', viaRuntime, 'aax'), direct.test('aax'))
    assert.equal(viaRuntime.lastIndex, direct.lastIndex)
    assert.equal(viaRuntime.lastIndex, 3)
    // A second call starts where the first left off, as `RegExp.prototype.test` does.
    assert.equal(testModerationRegex('x', viaRuntime, 'aax'), direct.test('aax'))
    assert.equal(viaRuntime.lastIndex, direct.lastIndex)
  } finally {
    fresh()
  }
})
