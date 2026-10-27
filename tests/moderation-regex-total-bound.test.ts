/**
 * Layer 2 of `moderation-regex` bounds TOTAL time, not just one window (verify of wave3 4.3c,
 * C1). The hard `vm` timeout interrupts a single window that runs 200 ms. A cubic rule that
 * stays UNDER that per window — `[а-я]+[а-я]+\d`, `[а-я]*[а-я]*$`, `₫*₫*$`, `(?:ж|з)*ж*$`, each
 * 158–184 ms on a 1000-char window (Node 24/26), all accepted by Layer 1 — was never
 * interrupted, never disabled, never logged; and the chat endpoints screen up to 30 earlier
 * user turns, so one anonymous request blocked the event loop 4.1 s (Node 24, 301ba0d; 4.87 s
 * on e0d5ca2), repeatably, and a comment 0.42–0.50 s.
 *
 * The guarantee these pin (as documented in CLAUDE.md and `docs/decisions/realm-safety.md`):
 *   - per rule: at most 1 s of matching per 60-s period (plus the one window that crosses it),
 *     then it is disabled 10 minutes and logged (`reason: 'cumulative'`);
 *   - per request (both chat endpoints, a comment): at most 250 ms of matching in total;
 *   - a window that is interrupted is blamed on the rule running it, without a second run.
 * The numbers are written here as the documented values; `moderation-regex-seams-behavior`
 * pins the exported constants to them.
 *
 * Real patterns on the real clock, so the slow windows are calibrated to ~40 ms on THIS machine
 * (one window of a cubic pattern costs ∝ n³) — far under the 200-ms window budget, so on a slow
 * runner a window is still not interrupted and the bound under test is the total one. Every
 * async body runs under `withinWallClockAsync` (a watchdog thread kills the process), every
 * synchronous call under `withinWallClock` (`vm`): a regression fails within a minute.
 */
import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import vm from 'node:vm'
import { HANDLERS, kindOf, moderationRegex, reset, rule, send, worker } from './_chat-real-moderation.ts'
import { withinWallClockAsync } from './_async-wall-clock-bound.ts'
import { withinWallClock } from './_wall-clock-bound.ts'

const { compileModerationRegex, isModerationRuleDisabled, testModerationRegex, testModerationRegexes, MODERATION_RULE_WINDOW_BUDGET_MS } = moderationRegex

/** The documented guarantee. */
const RULE_BUDGET_MS = 1000
const REQUEST_BUDGET_MS = 250
/** Scheduling, interrupt latency and the non-regex work of a request, generous for a loaded runner. */
const SLACK_MS = 150
const WATCHDOG_MS = 60_000

type LogLine = Record<string, unknown>

/** Capture the JSON log lines (`logWarn` writes them to `console.error`) while `run` runs. */
async function captureLogs<T>(run: () => Promise<T>): Promise<{ value: T, lines: LogLine[] }> {
  const lines: LogLine[] = []
  const spy = mock.method(console, 'error', (line: unknown) => {
    try { lines.push(JSON.parse(String(line)) as LogLine) } catch { /* not a log line */ }
  })
  try {
    return { value: await run(), lines }
  } finally {
    spy.mock.restore()
  }
}

/** Wall time of `run`, and the longest gap between 2-ms heartbeat ticks while it ran. */
async function timed<T>(run: () => Promise<T>): Promise<{ value: T, wallMs: number, maxGapMs: number }> {
  let last = performance.now()
  let maxGap = 0
  const timer = setInterval(() => { const now = performance.now(); maxGap = Math.max(maxGap, now - last); last = now }, 2)
  await new Promise(resolve => setTimeout(resolve, 10))
  maxGap = 0
  last = performance.now()
  const started = performance.now()
  const value = await run()
  const wallMs = performance.now() - started
  await new Promise(resolve => setTimeout(resolve, 10))
  clearInterval(timer)
  return { value, wallMs, maxGapMs: Math.max(maxGap, performance.now() - last) }
}

/** `runInContext` calls made while `run` runs (0 = no rule was matched at all). */
async function vmCalls(run: () => Promise<unknown>): Promise<number> {
  const spy = mock.method(vm.Script.prototype, 'runInContext')
  try {
    await run()
    return spy.mock.callCount()
  } finally {
    spy.mock.restore()
  }
}

const slowText = (unit: string, length: number) => `${unit.repeat(length - 1)}!`

/**
 * The length n of `unit × (n − 1) + '!'` on which ONE window of the cubic `pattern` costs about
 * `targetMs` here. Warms the very RegExp object the runtime will run (`compileModerationRegex`
 * caches it), so the measured cost is the compiled one, not V8's first interpreted run.
 */
function calibrate(pattern: string, unit: string, targetMs: number): { length: number, windowMs: number } {
  const regex = compileModerationRegex(pattern)
  assert.ok(regex, `Layer 1 accepts ${pattern} — that is the point`)
  // The fastest of three runs: a throttled container (`--cpus 0.5`) stretches some runs ×2–×5.
  const cost = (length: number) => Math.min(...[0, 1, 2].map(() => {
    const started = performance.now()
    regex.test(slowText(unit, length))
    return performance.now() - started
  }))
  cost(80); cost(80); cost(300)
  let length = 300
  let ms = cost(length)
  while (ms < 2 && length < 1000) { length = Math.min(1000, length * 2); ms = cost(length) }
  length = Math.max(150, Math.min(1000, Math.round(length * Math.cbrt(targetMs / Math.max(ms, 0.01)))))
  return { length, windowMs: cost(length) }
}

const slowDisabledLines = (lines: LogLine[], pattern: string) =>
  lines.filter(line => line.event === 'ai_moderation.rule_slow_disabled' && line.pattern === pattern)

// ── (a) per rule: cumulative budget ──────────────────────────────────────────

test('a rule just under the window budget, run again and again, is disabled once it has used 1 s — logged with reason "cumulative"', () => {
  reset([])
  const pattern = 'chậm-dưới-ngưỡng'
  let calls = 0
  // 25 ms of real busy time per window: nowhere near the 200-ms window budget.
  const regex = { test: () => { calls += 1; const end = performance.now() + 25; while (performance.now() < end); return false } } as unknown as RegExp
  const lines: LogLine[] = []
  const spy = mock.method(console, 'error', (line: unknown) => { try { lines.push(JSON.parse(String(line)) as LogLine) } catch { /* not a log line */ } })
  let spent = 0
  try {
    for (let i = 0; i < 100 && !isModerationRuleDisabled(pattern); i += 1) {
      const started = performance.now()
      assert.equal(withinWallClock(5000, pattern, () => testModerationRegex(pattern, regex, 'một cửa sổ')), false)
      spent += performance.now() - started
    }
  } finally {
    spy.mock.restore()
  }
  assert.equal(isModerationRuleDisabled(pattern), true, `still enabled after ${calls} windows, ${spent.toFixed(0)} ms of blocking`)
  assert.ok(spent <= RULE_BUDGET_MS + MODERATION_RULE_WINDOW_BUDGET_MS + SLACK_MS, `blocked ${spent.toFixed(0)} ms in total before it was disabled`)
  const logged = slowDisabledLines(lines, pattern)
  assert.equal(logged.length, 1, 'logged once')
  if (logged[0]!.reason === 'window') {
    // Only a throttled runner (`--cpus 0.5`) stalls one 25-ms busy window past 200 ms; the fake-clock
    // tests (`moderation-regex-budget`, seams "per-rule budget") pin 'cumulative' deterministically.
    assert.ok(Number(logged[0]!.elapsedMs) > MODERATION_RULE_WINDOW_BUDGET_MS, `reason window on a ${String(logged[0]!.elapsedMs)}-ms window`)
  } else {
    assert.equal(logged[0]!.reason, 'cumulative')
    // ~40 windows of 25 ms; fewer on a throttled runner, where a stall lengthens a window's wall time.
    assert.ok(calls >= 5, `${calls} windows: disabled by the total, not by one window`)
    assert.ok(Number(logged[0]!.elapsedMs) >= RULE_BUDGET_MS, `elapsedMs ${String(logged[0]!.elapsedMs)} is the total charged`)
  }
  const before = calls
  assert.equal(testModerationRegex(pattern, regex, 'một cửa sổ'), false)
  assert.equal(calls, before, 'disabled: not run again')
  reset([])
})

const SUB_BUDGET: Array<[pattern: string, unit: string]> = [
  ['[а-я]+[а-я]+\\d', 'ж'],
  ['[а-я]*[а-я]*$', 'ж'],
  ['₫*₫*$', '₫'],
  ['(?:ж|з)*ж*$', 'ж'],
]
const ENTRY_POINTS: Array<[name: string, call: (text: string) => Promise<unknown>]> = [
  ['matchInstantRule', text => worker.matchInstantRule(text)],
  ['fastPreModerate', text => worker.fastPreModerate(text, { targetType: 'chat' })],
  ['checkAndModerateContent', text => worker.checkAndModerateContent({ content: text, targetType: 'comment', targetId: 7 })],
]
const SCENARIOS = [
  ...ENTRY_POINTS.map(entry => [SUB_BUDGET[0]!, entry] as const),
  [SUB_BUDGET[1]!, ENTRY_POINTS[0]!] as const,
  [SUB_BUDGET[2]!, ENTRY_POINTS[1]!] as const,
  [SUB_BUDGET[3]!, ENTRY_POINTS[2]!] as const,
]

for (const [[pattern, unit], [entry, call]] of SCENARIOS) {
  test(`(a) ${pattern} through ${entry}, repeated: the event loop is blocked < 1.5 s in total, then the rule is off and calls are instant`, async () => {
    await withinWallClockAsync(WATCHDOG_MS, `${pattern} via ${entry}`, async () => {
      reset([rule(pattern)])
      const { length, windowMs } = calibrate(pattern, unit, 40)
      const text = slowText(unit, length)
      let spent = 0
      let maxGap = 0
      let calls = 0
      const { lines } = await captureLogs(async () => {
        // Stop at the bound being tested (and twice it), not at a count guessed from the calibration.
        for (; calls < 400 && spent < 3000 && !isModerationRuleDisabled(pattern); calls += 1) {
          const run = await timed(() => call(text))
          spent += run.wallMs
          maxGap = Math.max(maxGap, run.maxGapMs)
        }
      })
      const label = `${pattern} on ${length} chars (${windowMs.toFixed(0)} ms/window here), ${calls} calls via ${entry}`
      assert.equal(isModerationRuleDisabled(pattern), true, `${label}: still enabled after ${spent.toFixed(0)} ms of blocking`)
      assert.ok(spent < 1500, `${label}: blocked ${spent.toFixed(0)} ms in total`)
      assert.ok(maxGap < MODERATION_RULE_WINDOW_BUDGET_MS * 2 + SLACK_MS, `${label}: longest single block ${maxGap.toFixed(0)} ms`)
      const logged = slowDisabledLines(lines, pattern)
      assert.equal(logged.length, 1, `${label}: logged once`)
      // 'cumulative' here; 'window' only if this runner made one ~40-ms window cost > 200 ms.
      assert.ok(['cumulative', 'window'].includes(String(logged[0]!.reason)), `${label}: reason ${String(logged[0]!.reason)}`)
      assert.equal(await vmCalls(() => call(text)), 0, `${label}: disabled — the next call matches nothing at all`)
      reset([])
    })
  })
}

// ── (b) per request: the 30-turn chat request ───────────────────────────────

/** 30 distinct user turns (the chat cap), each a slow no-match window for `[а-я]+[а-я]+\d`. */
const thirtyTurns = (length: number) => Array.from({ length: 30 }, (_, i) => ({ role: 'user', content: `${'з'.repeat(i)}${'ж'.repeat(length - 1 - i)}!` }))

for (const [name, handler] of HANDLERS) {
  test(`(b) ${name}: a 30-turn request with a sub-budget rule spends ≤ 250 ms matching; the rule is off after ~1 s in total`, async () => {
    await withinWallClockAsync(WATCHDOG_MS, `${name} 30 turns`, async () => {
      const pattern = '[а-я]+[а-я]+\\d'
      reset([rule(pattern)])
      const { length, windowMs } = calibrate(pattern, 'ж', 40)
      const history = thirtyTurns(length)
      const requests: Array<{ wallMs: number, maxGapMs: number, disabled: boolean }> = []
      await captureLogs(async () => {
        for (let i = 0; i < 12 && !isModerationRuleDisabled(pattern); i += 1) {
          const run = await timed(() => send(handler, history))
          assert.notEqual(kindOf(run.value), 'moderation_blocked', 'no turn matches')
          requests.push({ wallMs: run.wallMs, maxGapMs: run.maxGapMs, disabled: isModerationRuleDisabled(pattern) })
        }
      })
      const label = `${length}-char turns at ${windowMs.toFixed(0)} ms/window here (unbounded: ~${(30 * windowMs).toFixed(0)} ms per request): ${requests.map(r => r.wallMs.toFixed(0)).join(', ')} ms`
      for (const request of requests) {
        assert.ok(request.wallMs <= REQUEST_BUDGET_MS + SLACK_MS, `${label}: one request over the per-request budget`)
        assert.ok(request.maxGapMs <= REQUEST_BUDGET_MS + SLACK_MS, `${label}: the event loop was blocked ${request.maxGapMs.toFixed(0)} ms at once`)
      }
      assert.equal(isModerationRuleDisabled(pattern), true, `${label}: still enabled`)
      const total = requests.reduce((sum, request) => sum + request.wallMs, 0)
      assert.ok(total <= RULE_BUDGET_MS + REQUEST_BUDGET_MS + SLACK_MS, `${label}: ${total.toFixed(0)} ms in total before it was disabled`)
      const after = await timed(() => send(handler, history))
      assert.ok(after.wallMs < 50, `disabled: the next request is instant (${after.wallMs.toFixed(1)} ms)`)
      reset([])
    })
  })
}

/**
 * The NEWEST turn's check runs on the request budget too (verify of 4.3c follow-up, W2): one
 * text, twenty sub-budget rules of the same cubic shape — each window ~40 ms, far under the
 * 200-ms window budget even on a throttled runner, so no window is cut and only the request
 * budget bounds the request. Unbounded (mutant M11: the newest turn's `fastPreModerate` without
 * `regexBudget`) it is twenty windows, ~700–800 ms; bounded it is cut at 250 ms, nobody blamed.
 */
const NEWEST_TURN_RULES = ['а-я', 'а-ю', 'б-я', 'в-я', 'г-я'].flatMap(first => ['а-я', 'а-ю', 'б-я', 'в-я'].map(second => `[${first}]+[${second}]+\\d`))

for (const [name, handler] of HANDLERS) {
  test(`(b) ${name}: a newest turn slow on several rules is cut at the request budget (250 ms), not one window per rule`, async () => {
    await withinWallClockAsync(WATCHDOG_MS, `${name} newest turn`, async () => {
      reset(NEWEST_TURN_RULES.map(pattern => rule(pattern)))
      const { length } = calibrate(NEWEST_TURN_RULES[0]!, 'ж', 40)
      const text = slowText('ж', length)
      // What the newest turn costs UNBOUNDED on this runner: each rule's one window, measured
      // after V8 compiled the regex to native code (its first, interpreted run on a long subject
      // is ~10× slower — warm it on short ones) — so the bound below is not vacuous.
      const unboundedMs = NEWEST_TURN_RULES.reduce((sum, pattern) => {
        const regex = compileModerationRegex(pattern)!
        for (const warm of [80, 80, 300]) regex.test(slowText('ж', warm))
        const started = performance.now()
        regex.test(text)
        return sum + performance.now() - started
      }, 0)
      assert.ok(unboundedMs > REQUEST_BUDGET_MS + 2 * SLACK_MS, `precondition: ${unboundedMs.toFixed(0)} ms unbounded must clearly exceed the bound`)
      const { value: run, lines } = await captureLogs(() => timed(() => send(handler, [{ role: 'user', content: text }])))
      const label = `${length} chars, ${NEWEST_TURN_RULES.length} rules, ${unboundedMs.toFixed(0)} ms unbounded here: ${run.wallMs.toFixed(0)} ms`
      assert.notEqual(kindOf(run.value), 'moderation_blocked', 'no rule matches')
      assert.ok(run.wallMs <= REQUEST_BUDGET_MS + SLACK_MS, `${label}: over the per-request budget`)
      assert.ok(run.maxGapMs <= REQUEST_BUDGET_MS + SLACK_MS, `${label}: the event loop was blocked ${run.maxGapMs.toFixed(0)} ms at once`)
      assert.equal(lines.filter(line => line.event === 'ai_moderation.request_budget_exhausted').length, 1, `${label}: the cut is logged once`)
      assert.deepEqual(NEWEST_TURN_RULES.filter(pattern => isModerationRuleDisabled(pattern)), [], 'the request running out blames nobody')
      reset([])
    })
  })
}

// ── (c) innocent rules keep working ─────────────────────────────────────────

test('(c) an innocent rule is never disabled while the offender is used up, and matches as soon as it is off', async () => {
  await withinWallClockAsync(WATCHDOG_MS, 'innocent after offender', async () => {
    const offender = '[а-я]+[а-я]+\\d'
    const innocent = 'lô\\s*đề'
    reset([rule(offender), rule(innocent)])
    const { length } = calibrate(offender, 'ж', 40)
    const history = thirtyTurns(length)
    await captureLogs(async () => {
      for (let i = 0; i < 12 && !isModerationRuleDisabled(offender); i += 1) {
        await send(HANDLERS[0][1], history)
        assert.equal(isModerationRuleDisabled(innocent), false, 'the innocent rule is never blamed')
      }
    })
    assert.equal(isModerationRuleDisabled(offender), true)
    const reply = await send(HANDLERS[0][1], [...history.slice(0, 3), { role: 'user', content: 'chơi lô đề ở đâu' }])
    assert.equal(kindOf(reply), 'moderation_blocked', 'the innocent rule matches the newest turn')
    assert.ok(await worker.matchInstantRule('nhắn lô đề'), 'and an earlier turn')
    assert.equal(isModerationRuleDisabled(innocent), false)
    reset([])
  })
})

// ── (d) a catastrophic rule costs ~one window budget, wherever it sits ──────

const VIETNAMESE_RULES = [
  '(lừa đảo|chiếm đoạt|vay nặng lãi)', '\\b(cờ bạc|cá độ)\\b', 'cờ[\\s,.]+bạc', 'đ[ụu]\\s*m[áa]', 'ma.{0,20}túy',
  '(?:0|\\+84)\\d{9}', '(\\d[\\s.]?){9,10}', '(\\d{3,4}[\\s.-]?){2,3}', '\\p{L}+\\s+bậy', '(cờ|cá)\\s+(bạc|độ)+',
  '(https?://)?(www\\.)?(bet|casino)', '(fb88|w88|m88)+', '(đéo|địt|đụ)+', 'k[h]?ông\\s+(ai|người)\\s+(biết)?',
  '(mẹ|má) (mày|mi)', '(\\W|^)(ngu)(\\W|$)', '(\\s|^)ngu(\\s|$)', 'cờ.{0,30}bạc.{0,30}online', 'abc\\d+',
  '(foo|bar)+', 'ca\\s?độ', '[0-9]{9,11}', '\\b(tài|tai)\\s*xỉu\\b', '(?:đm|dm)+', '(ab|cd){2,5}', 'https?://\\S+',
  '(\\d{3})-(\\d{4})', 'lô\\s*đề', 'đánh\\s*bài\\s*online', 'nhà\\s*cái\\s*uy\\s*tín',
]

for (const [entry, call] of ENTRY_POINTS.filter(([name]) => name !== 'fastPreModerate')) {
  test(`(d) ${entry}: a catastrophic rule in the MIDDLE of 30 costs one window budget (~200 ms), not two`, async () => {
    await withinWallClockAsync(WATCHDOG_MS, `middle of 30 via ${entry}`, async () => {
      const bad = '日*日*日*$'
      const patterns = [...VIETNAMESE_RULES.slice(0, 15), bad, ...VIETNAMESE_RULES.slice(15)]
      reset(patterns.map(pattern => rule(pattern)))
      const text = `${'日'.repeat(1500)}!`
      // V8 compiles each regex to native code on its first long subject (a few ms each): warm the
      // very objects the runtime will run (`compileModerationRegex` caches them), not the bad one.
      for (const pattern of VIETNAMESE_RULES) for (let i = 0; i < 2; i += 1) compileModerationRegex(pattern)!.test(text)
      // How many times the bad rule's window ran: the deterministic tell (2 before: cut ~200 ms in
      // as the 16th rule of its pass, re-run, cut again). Counted on the RegExp the runtime runs.
      let badWindows = 0
      const original = RegExp.prototype.test
      const spy = mock.method(RegExp.prototype, 'test', function (this: RegExp, input: string) {
        if (this.source === bad) badWindows += 1
        return original.call(this, input)
      })
      let measured: { value: { wallMs: number, maxGapMs: number }, lines: LogLine[] } | undefined
      try {
        measured = await captureLogs(() => timed(() => call(text)))
      } finally {
        spy.mock.restore()
      }
      const { value: run, lines } = measured
      assert.equal(badWindows, 1, 'the catastrophic window ran once — cut, blamed, never re-run')
      // On top of the one cut window: the 29 healthy rules on 1501 chars and the rest of the call, which
      // runs as ONE macrotask here (every await resolves at once). ~200–270 ms at 2 CPUs; a throttled
      // runner (`--cpus 0.5`) stretches the healthy part, so the wall bound is generous.
      assert.ok(run.maxGapMs <= MODERATION_RULE_WINDOW_BUDGET_MS + 250, `longest block ${run.maxGapMs.toFixed(0)} ms, wall ${run.wallMs.toFixed(0)} ms (was ~404–436)`)
      assert.deepEqual(patterns.filter(pattern => isModerationRuleDisabled(pattern)), [bad])
      assert.deepEqual(lines.filter(line => line.event === 'ai_moderation.rule_slow_disabled').map(line => [line.pattern, line.interrupted]), [[bad, true]])
      assert.ok(await worker.matchInstantRule('chơi lô đề ở đây'), 'a rule after it still matches')
      reset([])
    })
  })
}

test('(d) a heavy-but-legal rule before a catastrophic one: the catastrophic one is cut once (~60 + 200 ms), the heavy one is never blamed', () => {
  reset([])
  let heavyCalls = 0
  let badCalls = 0
  const heavy = { pattern: 'nặng-mà-hợp-lệ', regex: { test: () => { heavyCalls += 1; const end = performance.now() + 60; while (performance.now() < end); return false } } as unknown as RegExp }
  const bad = '日*日*日*$'
  const badRegex = compileModerationRegex(bad)!
  const rules = [heavy, { pattern: bad, regex: { test: (s: string) => { badCalls += 1; return badRegex.test(s) } } as unknown as RegExp }, { pattern: 'lô\\s*đề', regex: compileModerationRegex('lô\\s*đề')! }]
  const lines: LogLine[] = []
  const spy = mock.method(console, 'error', (line: unknown) => { try { lines.push(JSON.parse(String(line)) as LogLine) } catch { /* not a log line */ } })
  const started = performance.now()
  let hits: boolean[] = []
  try {
    hits = withinWallClock(5000, 'heavy then catastrophic', () => testModerationRegexes(rules, `${'日'.repeat(1500)}! lô đề`))
  } finally {
    spy.mock.restore()
  }
  const wallMs = performance.now() - started
  assert.deepEqual(hits, [false, false, true])
  assert.equal(heavyCalls, 1, 'the heavy rule ran once')
  assert.equal(badCalls, 1, 'the catastrophic window ran once (it was 2: cut ~140 ms in, re-run, cut again)')
  assert.ok(wallMs <= 60 + MODERATION_RULE_WINDOW_BUDGET_MS + 150, `${wallMs.toFixed(0)} ms (was ~400)`)
  assert.equal(isModerationRuleDisabled(heavy.pattern), false)
  assert.equal(isModerationRuleDisabled(bad), true)
  assert.deepEqual(lines.filter(line => line.event === 'ai_moderation.rule_slow_disabled').map(line => line.pattern), [bad])
  reset([])
})
