/**
 * The 4.3c follow-up API of `moderation-regex` (C1, W1–W2, S1–S4 of the verify of 4.3c):
 *   - `createModerationRegexBudget` — the per-request budget, shared by every matching call of
 *     one request;
 *   - `testModerationRegexBatch` — several texts in ONE bounded `vm` pass (the chat history);
 *     `matchInstantRuleBatch` — the same for the instant check, exactly `texts.map(matchInstantRule)`;
 *   - attribution: a window interrupted by the hard timeout is blamed without a re-run, a cut
 *     BETWEEN windows blames nobody (S1), a pass that never reached a window is logged (S2),
 *     `test()` runs once per window (S3);
 *   - S4: `node:vm` is not a sandbox, so the only script ever compiled is the constant
 *     `'scan(job)'` — an AST guard over `server/`.
 * The end-to-end bounds (real patterns, real handlers) are in `moderation-regex-total-bound.test.ts`.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test, { mock } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { HANDLERS, reset, rule, send, worker } from './_chat-real-moderation.ts'
import {
  MODERATION_REQUEST_BUDGET_MS,
  MODERATION_RULE_CUMULATIVE_BUDGET_MS,
  MODERATION_RULE_WINDOW_BUDGET_MS,
  compileModerationRegex,
  createModerationRegexBudget,
  isModerationRuleDisabled,
  resetSlowModerationRules,
  scanModerationRegexBatch,
  setModerationRegexTimingForTests,
  testModerationRegexBatch,
  testModerationRegexes,
} from '../server/services/moderation-regex.ts'
import { MODERATION_RULE_MIN_CHARGED_WINDOW_MS } from '../server/services/moderation-regex-budget.ts'
import { withinWallClock } from './_wall-clock-bound.ts'

type LogLine = Record<string, unknown>
const OUTER_BOUND_MS = 5000

function captureLogs<T>(run: () => T): { value: T, lines: LogLine[] } {
  const lines: LogLine[] = []
  const spy = mock.method(console, 'error', (line: unknown) => {
    try { lines.push(JSON.parse(String(line)) as LogLine) } catch { /* not a log line */ }
  })
  try {
    return { value: run(), lines }
  } finally {
    spy.mock.restore()
  }
}
const events = (lines: LogLine[], event: string) => lines.filter(line => line.event === event)

function fresh(): void {
  setModerationRegexTimingForTests(null)
  resetSlowModerationRules()
}

/** A fake rule costing `cost` ms of the fake clock per window, recording each window it runs. */
function fakeRule(clock: { t: number }, pattern: string, cost: number, match = false) {
  const windows: string[] = []
  return { windows, rule: { pattern, regex: { test: (slice: string) => { windows.push(slice); clock.t += cost; return match } } as unknown as RegExp } }
}
/** Busy-wait `ms` of real time per window. */
const busyRule = (pattern: string, ms: number, result = false) => ({
  pattern,
  regex: { test: () => { const end = performance.now() + ms; while (performance.now() < end); return result } } as unknown as RegExp,
})
/** This thread's CPU time (ms) — what the per-rule budget charges (W6). */
const threadCpuMs = () => { const { user, system } = process.threadCpuUsage(); return (user + system) / 1000 }
/**
 * Busy-wait `ms` of this thread's CPU time per window: a constant CHARGE on any runner. A wall-time
 * spin on a throttled one (`--cpus 0.5`) is only ~half CPU, so it is charged half (W6).
 */
const cpuBusyRule = (pattern: string, ms: number) => ({
  pattern,
  regex: { test: () => { const end = threadCpuMs() + ms; while (threadCpuMs() < end); return false } } as unknown as RegExp,
})

/** A fake clock; with `withCpu`, also a fake CPU clock (`clock.cpu`) the per-rule budget charges. */
function withFakeClock<T>(run: (clock: { t: number, now: number, cpu: number }) => T, withCpu = false): T {
  const clock = { t: 0, now: 1_000_000, cpu: 0 }
  setModerationRegexTimingForTests({ elapsed: () => clock.t, now: () => clock.now, ...(withCpu ? { cpu: () => clock.cpu } : {}) })
  resetSlowModerationRules()
  try {
    return run(clock)
  } finally {
    fresh()
  }
}

/** Count the runtime's bounded `vm` passes while `run` runs (not `withinWallClock`'s own, 5-s, call). */
function vmPasses<T>(run: () => T): { value: T, passes: number } {
  const spy = mock.method(vm.Script.prototype, 'runInContext')
  try {
    const value = run()
    return { value, passes: spy.mock.calls.filter(call => Number(call.arguments[1]?.timeout) <= MODERATION_RULE_WINDOW_BUDGET_MS).length }
  } finally {
    spy.mock.restore()
  }
}

// ── Per-request budget ──────────────────────────────────────────────────────

test('request budget: shared by every call of the request; a window that would start past it never runs; logged once, naming the top consumer', () => {
  withFakeClock((clock) => {
    const a = fakeRule(clock, 'a', 120)
    const b = fakeRule(clock, 'b', 100)
    const c = fakeRule(clock, 'c', 50)
    const d = fakeRule(clock, 'd', 10)
    const budget = createModerationRegexBudget(250)
    const { value: first, lines } = captureLogs(() => testModerationRegexes([a.rule, b.rule, c.rule, d.rule], 'x', { budget }))
    assert.deepEqual(first, [false, false, false, false])
    assert.deepEqual([a, b, c, d].map(r => r.windows.length), [1, 1, 1, 0], 'd would start at 270 ms > 250: it never runs')
    assert.deepEqual(events(lines, 'ai_moderation.request_budget_exhausted').map(({ budgetMs, spentMs, topPattern, topPatternMs, texts }) => ({ budgetMs, spentMs, topPattern, topPatternMs, texts })), [
      { budgetMs: 250, spentMs: 270, topPattern: 'a', topPatternMs: 120, texts: 1 },
    ])
    assert.deepEqual(events(lines, 'ai_moderation.rule_slow_disabled'), [], 'nobody is disabled for the request running out')
    // The same request's next call: nothing left — no pass at all, no second log line.
    const { value: second, passes } = vmPasses(() => captureLogs(() => testModerationRegexes([d.rule], 'y', { budget })))
    assert.deepEqual(second.value, [false])
    assert.equal(passes, 0)
    assert.equal(d.windows.length, 0)
    assert.deepEqual(second.lines, [])
    // A new request gets a new budget.
    assert.deepEqual(testModerationRegexes([d.rule], 'y', { budget: createModerationRegexBudget() }), [false])
    assert.equal(d.windows.length, 1)
  })
})

test('request budget (real clock): ten 60-ms rules on one text cost ≈ the budget, not 600 ms; the rule cut by the deadline is not blamed', () => {
  fresh()
  let ran = 0
  const rules = Array.from({ length: 10 }, (_, i) => {
    const busy = busyRule(`bận-${i}`, 60, i === 9)
    return { pattern: busy.pattern, regex: { test: (s: string) => { ran += 1; return busy.regex.test(s) } } as unknown as RegExp }
  })
  const started = performance.now()
  const { value: hits, lines } = captureLogs(() => withinWallClock(OUTER_BOUND_MS, 'request budget', () =>
    testModerationRegexes(rules, 'x', { budget: createModerationRegexBudget() })))
  const wallMs = performance.now() - started
  assert.ok(ran <= 5, `${ran} of 10 rules started: 250 ms holds at most 4 whole 60-ms windows and one cut`)
  assert.ok(wallMs < MODERATION_REQUEST_BUDGET_MS + 150, `${wallMs.toFixed(0)} ms for ${MODERATION_REQUEST_BUDGET_MS} ms of budget (600 unbounded)`)
  assert.equal(hits[9], false, 'the matching rule after the deadline is not reached (fail-open, logged)')
  assert.equal(events(lines, 'ai_moderation.request_budget_exhausted').length, 1)
  assert.deepEqual(events(lines, 'ai_moderation.rule_slow_disabled'), [])
  for (const rule of rules) assert.equal(isModerationRuleDisabled(rule.pattern), false)
  fresh()
})

test('request budget: a catastrophic rule reached with 50 ms left is cut at the deadline, not blamed; with a full window budget it is', () => {
  fresh()
  const bad = '日*日*日*$'
  const text = `${'日'.repeat(1500)}!`
  const budget = createModerationRegexBudget(MODERATION_REQUEST_BUDGET_MS)
  const head = busyRule('nặng', 170, false) // under the window budget; leaves ~80 ms of the request
  const started = performance.now()
  const { lines } = captureLogs(() => withinWallClock(OUTER_BOUND_MS, 'deadline cut', () =>
    testModerationRegexes([head, { pattern: bad, regex: compileModerationRegex(bad)! }], text, { budget })))
  assert.ok(performance.now() - started < MODERATION_REQUEST_BUDGET_MS + 150)
  assert.equal(isModerationRuleDisabled(bad), false, 'cut by the request deadline — not its full window budget')
  const exhausted = events(lines, 'ai_moderation.request_budget_exhausted')
  assert.equal(exhausted.length, 1)
  assert.equal(exhausted[0]!.topPattern, 'nặng')
  // A fresh request gives it its full window: interrupted, blamed, disabled.
  const { lines: again } = captureLogs(() => withinWallClock(OUTER_BOUND_MS, 'full window', () =>
    testModerationRegexes([{ pattern: bad, regex: compileModerationRegex(bad)! }], text, { budget: createModerationRegexBudget() })))
  assert.equal(isModerationRuleDisabled(bad), true)
  assert.deepEqual(events(again, 'ai_moderation.rule_slow_disabled').map(line => [line.reason, line.interrupted]), [['window', true]])
  fresh()
})

test('a window cut by the request deadline is still charged to its rule at once: a rule cut every time is off after ~1 s (reason cumulative)', () => {
  // 300 ms per window, 100 ms per request: every window is cut by the deadline — never blamed
  // per window — and never completes, so only the charge of the cut window's own time (in
  // `runScan`) ever reaches the rule's period. Without it the rule would run forever.
  fresh()
  const slow = busyRule('bị-cắt-mãi', 300)
  const lines: LogLine[] = []
  const walls: number[] = []
  const cpus: number[] = []
  let requests = 0
  for (; requests < 40 && !isModerationRuleDisabled(slow.pattern); requests += 1) {
    const started = performance.now()
    const cpuStarted = threadCpuMs()
    lines.push(...captureLogs(() => withinWallClock(OUTER_BOUND_MS, 'cut by deadline', () =>
      testModerationRegexes([slow], 'x', { budget: createModerationRegexBudget(100) }))).lines)
    cpus.push(threadCpuMs() - cpuStarted)
    walls.push(performance.now() - started)
  }
  assert.equal(isModerationRuleDisabled(slow.pattern), true, `still on after ${requests} requests cut at 100 ms`)
  // The bounds that hold on any runner. Each cut window is charged its own CPU time (≤ its wall
  // time), measured INSIDE the request, so the charges never exceed what the requests used: the
  // rule cannot be off before they together used ≥ 1 s of CPU (and of wall). Off sooner means
  // some window was charged more than once (mutant M15: 2 × — off after ~0.5 s). And it is off
  // as soon as the charges reach 1 s: the CPU of the cut windows is nearly all of the requests'
  // (~10 requests of ~100 ms; ~20 of ~50 ms of CPU on a runner throttled to half a CPU, where the
  // 100-ms deadline is wall time). Exactly-once is pinned on a fake clock in the next tests.
  const total = (list: number[]) => list.reduce((sum, ms) => sum + ms, 0)
  const label = `${requests} requests, CPU ${cpus.map(ms => ms.toFixed(0)).join('+')} = ${total(cpus).toFixed(0)} ms, wall ${total(walls).toFixed(0)} ms, before it was off`
  assert.ok(total(walls) >= MODERATION_RULE_CUMULATIVE_BUDGET_MS, label)
  assert.ok(total(cpus) >= MODERATION_RULE_CUMULATIVE_BUDGET_MS, label)
  assert.ok(total(cpus) <= MODERATION_RULE_CUMULATIVE_BUDGET_MS + Math.max(...cpus) + 2 * requests, label)
  assert.deepEqual(events(lines, 'ai_moderation.rule_slow_disabled').map(line => line.reason), ['cumulative'])
  fresh()
})

test('a window cut by the request deadline is charged its own time EXACTLY once (fake clock): 60 ms per request → off at the 17th, 1020 ms', () => {
  // The rule's window moves the fake clock 60 ms, then blocks REAL time until the request's
  // deadline interrupts it (the `vm` timeout is real; a 10-ms budget keeps each request short).
  // The cut window never reaches `ledger.set` in `scan`, so only `runScan` charges it — 60 ms of
  // the fake clock, deterministic. 16 × 60 = 960 < 1000 ≤ 17 × 60: the 17th request turns it off.
  // Charged twice (mutant M15) it is off at the 9th (1080); not charged (M7) never.
  withFakeClock((clock) => {
    let windows = 0
    const cut = { pattern: 'cắt-60', regex: { test: () => { windows += 1; clock.t += 60; for (;;); } } as unknown as RegExp }
    const lines: LogLine[] = []
    let requests = 0
    for (; requests < 30 && !isModerationRuleDisabled(cut.pattern); requests += 1) {
      const { value: hits, lines: logged } = captureLogs(() => withinWallClock(OUTER_BOUND_MS, 'cut at 10 ms', () =>
        testModerationRegexes([cut], 'x', { budget: createModerationRegexBudget(10) })))
      assert.deepEqual(hits, [false], 'a cut window has no result')
      lines.push(...logged)
    }
    assert.equal(requests, 17, `off after ${requests} requests: each cut window must be charged 60 ms, once`)
    assert.equal(windows, 17, 'one window per request, never re-run')
    assert.deepEqual(events(lines, 'ai_moderation.rule_slow_disabled').map(line => [line.reason, line.elapsedMs]), [['cumulative', 1020]])
    assert.equal(events(lines, 'ai_moderation.request_budget_exhausted').length, 17, 'every request ran out (and is logged once)')
  })
})

test('…and with a CPU clock the cut window is charged its CPU time, once: 60 ms wall / 40 ms CPU per request → off at the 25th, 1000 ms', () => {
  // The same cut window, on a fake clock WITH a fake CPU clock (W6): the process was "paused"
  // 20 of its 60 ms, so it is charged 40 — the CPU time — not 60. 24 × 40 = 960 < 1000 ≤ 25 × 40.
  // Charged the wall time on the cut path (mutant M19) it is off at the 17th.
  withFakeClock((clock) => {
    const cut = { pattern: 'cắt-cpu-40', regex: { test: () => { clock.t += 60; clock.cpu += 40; for (;;); } } as unknown as RegExp }
    const lines: LogLine[] = []
    let requests = 0
    for (; requests < 40 && !isModerationRuleDisabled(cut.pattern); requests += 1) {
      lines.push(...captureLogs(() => withinWallClock(OUTER_BOUND_MS, 'cut at 10 ms', () =>
        testModerationRegexes([cut], 'x', { budget: createModerationRegexBudget(10) }))).lines)
    }
    assert.equal(requests, 25, `off after ${requests} requests: each cut window must be charged its 40 ms of CPU, once`)
    assert.deepEqual(events(lines, 'ai_moderation.rule_slow_disabled').map(line => [line.reason, line.elapsedMs]), [['cumulative', 1000]])
  }, true)
})

test('a completed window is charged its CPU time, capped by its wall time: paused 49.1 of 50 ms → never charged; all CPU → off at the 20th', () => {
  // W6: a µs window that a throttled container's pause (or GC) stretched to 50 ms of wall time
  // used 0.9 ms of CPU — under the 1-ms floor, not charged at all. Mutant M18 (the meter charges
  // the wall time) turns it off at the 20th window. A window that really used its 50 ms is charged 50.
  const run = (cpuPerWindow: number, limit = 100) => withFakeClock((clock) => {
    const rule = { pattern: `cpu-${cpuPerWindow}`, regex: { test: () => { clock.t += 50; clock.cpu += cpuPerWindow; return false } } as unknown as RegExp }
    let windows = 0
    const { lines } = captureLogs(() => {
      for (; windows < limit && !isModerationRuleDisabled(rule.pattern); windows += 1) testModerationRegexes([rule], 'x')
    })
    return { windows, off: isModerationRuleDisabled(rule.pattern), logged: events(lines, 'ai_moderation.rule_slow_disabled').map(line => [line.reason, line.elapsedMs]) }
  }, true)
  // 1200 × 0.9 = 1080 ms of CPU, all in sub-ms pieces: charging them (mutant M16) is off at the 1112th.
  assert.deepEqual(run(0.9, 1200), { windows: 1200, off: false, logged: [] }, '60 s of wall, 1.08 s of CPU in sub-ms pieces: nothing charged')
  assert.deepEqual(run(50), { windows: 20, off: true, logged: [['cumulative', 1000]] })
  assert.deepEqual(run(80), { windows: 20, off: true, logged: [['cumulative', 1000]] }, 'CPU above wall (clock skew) is capped at the wall time')
})

test('the CPU clock is read only after a window that can be charged — the short windows before it are not billed to it', () => {
  // `openWindowMeter` reads the CPU clock at the start of a pass and after a window of ≥ 1 ms; the
  // CPU of the sub-ms windows in between is subtracted by their wall time. Here 30 rules of 0.5 ms
  // (all CPU) run before one window paused 49.5 of its 50 ms: charged 0.5 → 0, every time.
  // Billing it all the CPU since the last read (mutant M21) charges 15.5 ms → off at the 65th call.
  withFakeClock((clock) => {
    const quick = Array.from({ length: 30 }, (_, i) => ({ pattern: `nhanh-${i}`, regex: { test: () => { clock.t += 0.5; clock.cpu += 0.5; return false } } as unknown as RegExp }))
    const paused = { pattern: 'bị-dừng', regex: { test: () => { clock.t += 50; clock.cpu += 0.5; return false } } as unknown as RegExp }
    const { lines } = captureLogs(() => {
      for (let call = 0; call < 80; call += 1) testModerationRegexes([...quick, paused], 'x')
    })
    assert.equal(isModerationRuleDisabled(paused.pattern), false, 'never charged its neighbours\' CPU')
    assert.deepEqual(events(lines, 'ai_moderation.rule_slow_disabled'), [])
  }, true)
})

test('createModerationRegexBudget: a budget of 0 runs nothing; a negative one and a hand-made object are refused', () => {
  fresh()
  const { value, passes } = vmPasses(() => captureLogs(() => testModerationRegexes([{ pattern: 'a', regex: /a/iu }], 'a', { budget: createModerationRegexBudget(0) })))
  assert.deepEqual(value.value, [false])
  assert.equal(passes, 0)
  assert.equal(events(value.lines, 'ai_moderation.request_budget_exhausted').length, 1)
  assert.throws(() => createModerationRegexBudget(-1), RangeError)
  assert.throws(() => createModerationRegexBudget(Number.NaN), RangeError)
  assert.throws(() => testModerationRegexes([{ pattern: 'a', regex: /a/iu }], 'a', { budget: { limitMs: 250 } }), TypeError)
  assert.deepEqual(testModerationRegexes([{ pattern: 'a', regex: /a/iu }], 'a'), [true], 'no budget: the old behaviour')
})

// ── What the per-rule budget charges (verify of 4.3c follow-up, W6) ──────────

test('a window under 1 ms is noise, not charged: a rule at 0.9 ms per window never runs out; at 1 ms it is off after exactly 1000 windows', () => {
  // Healthy rules cost µs per window; wall time also counts what the process was NOT doing (a
  // throttled container's pauses, GC), and charging every µs window let heavy BENIGN traffic turn
  // healthy rules off (1 at 2 CPUs, 4 at 0.5 CPU, in 10 000 max-size chat requests). A window the
  // budget is meant for — an attacker's slow input — costs whole milliseconds.
  const run = (cost: number, windows: number) => withFakeClock((clock) => {
    const rule = fakeRule(clock, `mỗi-cửa-sổ-${cost}`, cost)
    const { lines } = captureLogs(() => {
      for (let i = 0; i < windows && !isModerationRuleDisabled(rule.rule.pattern); i += 1) testModerationRegexes([rule.rule], 'x')
    })
    return { ran: rule.windows.length, off: isModerationRuleDisabled(rule.rule.pattern), logged: events(lines, 'ai_moderation.rule_slow_disabled').map(line => [line.reason, line.elapsedMs]) }
  })
  assert.deepEqual(run(0.9, 2000), { ran: 2000, off: false, logged: [] }, '1800 ms of sub-ms windows: none charged')
  assert.deepEqual(run(1, 2000), { ran: 1000, off: true, logged: [['cumulative', 1000]] }, '1-ms windows are charged: off at the 1000th')
  assert.equal(MODERATION_RULE_MIN_CHARGED_WINDOW_MS, 1)
})

test('the books run on a MONOTONIC clock: the wall clock (Date) moving forward 11 min or back 1 h neither re-enables a rule nor resets its period', () => {
  fresh()
  mock.timers.enable({ apis: ['Date'], now: 1_800_000_000_000 })
  try {
    // A window over the window budget: off for 10 minutes of the MONOTONIC clock.
    const stuck = busyRule('đồng-hồ-tiến', MODERATION_RULE_WINDOW_BUDGET_MS + 60)
    captureLogs(() => withinWallClock(OUTER_BOUND_MS, 'disable', () => testModerationRegexes([stuck], 'x')))
    assert.equal(isModerationRuleDisabled(stuck.pattern), true)
    mock.timers.tick(11 * 60_000)
    assert.equal(isModerationRuleDisabled(stuck.pattern), true, 'Date moved 11 min forward: still off (on Date.now it came back on)')
    // A rule charged ~600 ms, the wall clock steps back an hour, ~400 ms more: off — the period
    // stood (on Date.now `now < periodStart` read as "period over" and forgot the 600 ms). It
    // spins 25 ms of CPU per window: charged 25 on any runner.
    const heavy = cpuBusyRule('đồng-hồ-lùi', 25)
    const lines: LogLine[] = []
    let windows = 0
    for (; windows < 24; windows += 1) lines.push(...captureLogs(() => testModerationRegexes([heavy], 'x')).lines)
    mock.timers.setTime(Date.now() - 60 * 60_000)
    for (; windows < 55 && !isModerationRuleDisabled(heavy.pattern); windows += 1) lines.push(...captureLogs(() => testModerationRegexes([heavy], 'x')).lines)
    assert.equal(isModerationRuleDisabled(heavy.pattern), true, `still on after ${windows} windows of 25 ms of CPU`)
    assert.ok(windows <= 41, `${windows} windows: the 600 ms before the step back were forgotten`)
    assert.deepEqual(events(lines, 'ai_moderation.rule_slow_disabled').map(line => line.reason), ['cumulative'])
  } finally {
    mock.timers.reset()
    fresh()
  }
})

// ── Per-rule cumulative budget across a batch ───────────────────────────────

test('cumulative budget across a batch: the same as the calls one by one — 7 × 150 ms windows, then off; the 8th text does not run it', () => {
  const texts = Array.from({ length: 9 }, (_, i) => `văn bản ${i}`)
  const run = (batched: boolean) => withFakeClock((clock) => {
    const slow = fakeRule(clock, 'chậm-150', 150)
    const { lines } = captureLogs(() => {
      if (batched) testModerationRegexBatch(texts.map(text => ({ rules: [slow.rule], text })))
      else for (const text of texts) testModerationRegexes([slow.rule], text)
    })
    return { windows: slow.windows.length, off: isModerationRuleDisabled('chậm-150'), logged: events(lines, 'ai_moderation.rule_slow_disabled').map(line => [line.reason, line.elapsedMs]) }
  })
  const expected = { windows: 7, off: true, logged: [['cumulative', 1050]] }
  assert.deepEqual(run(false), expected, 'one call per text')
  assert.deepEqual(run(true), expected, 'one batch')
  assert.ok(MODERATION_RULE_CUMULATIVE_BUDGET_MS === 1000)
})

// ── Batch = the calls one by one, in one vm pass ────────────────────────────

const REAL_RULES = ['lô\\s*đề', '(?:0|\\+84)\\d{9}', 'cờ[\\s,.]+bạc', 'nhà\\s*cái\\s*uy\\s*tín', '\\b(tài|tai)\\s*xỉu\\b']
const BATCH_TEXTS = ['', 'chơi lô đề', 'gọi 0912345678 nhé', 'bình thường', 'cờ, bạc và lô đề', 'nhà cái uy tín', `${'dài '.repeat(1500)} lô đề`]

/**
 * Pass counts below are about the pass STRUCTURE: a pass yields once it has run > 20 ms of the
 * runtime's clock, and a throttled runner (`--cpus 0.5`) can stall even a 1-ms scan past that.
 * Frozen, the clock never says 20 ms went by.
 */
const freezeClock = () => setModerationRegexTimingForTests({ elapsed: () => 0, now: () => 1_000_000 })

for (const stopAtFirstMatch of [false, true]) {
  test(`testModerationRegexBatch (stopAtFirstMatch: ${stopAtFirstMatch}): the same answers as one call per text, in ONE vm pass`, () => {
    fresh()
    freezeClock()
    const rules = REAL_RULES.map(pattern => ({ pattern, regex: compileModerationRegex(pattern)! }))
    const oneByOne = vmPasses(() => BATCH_TEXTS.map(text => testModerationRegexes(rules, text, { stopAtFirstMatch })))
    const batched = vmPasses(() => testModerationRegexBatch(BATCH_TEXTS.map(text => ({ rules, text })), { stopAtFirstMatch }))
    assert.deepEqual(batched.value, oneByOne.value)
    assert.equal(oneByOne.passes, BATCH_TEXTS.length)
    assert.equal(batched.passes, 1)
    assert.deepEqual(testModerationRegexBatch([]), [])
    fresh()
  })
}

test('matchInstantRuleBatch is exactly texts.map(matchInstantRule): built-ins, keyword before regex, rule order, empty texts', async () => {
  reset([
    rule('cá độ', 'keyword'),
    rule('lô\\s*đề'),
    rule('đề', 'keyword', { category: 'từ-khoá-sau' }),
    rule('(?:0|\\+84)\\d{9}', 'regex', { severity: 'critical' }),
    rule('(a+)+'), // refused by Layer 1: skipped on both paths
  ])
  freezeClock()
  const texts = ['', '   ', 'mày dcm', 'chơi lô đề', 'đề thi', 'cá độ và lô đề', 'gọi 0912345678', 'bình thường', 'aaaa', 'tài xỉu']
  const single = await Promise.all(texts.map(text => worker.matchInstantRule(text)))
  const spy = mock.method(vm.Script.prototype, 'runInContext')
  let batched: unknown
  try {
    batched = await worker.matchInstantRuleBatch(texts)
    assert.equal(spy.mock.callCount(), 1, 'one vm pass for the whole batch')
  } finally {
    spy.mock.restore()
  }
  assert.deepEqual(batched, single)
  assert.deepEqual(await worker.matchInstantRuleBatch([]), [])
  reset([])
})

// ── Unscanned is not clean (verify of 4.3c follow-up, W5) ───────────────────

test('scanModerationRegexBatch: `unscanned` marks exactly the texts the request budget left half-screened — not a rule that is off, not a text already matched', () => {
  withFakeClock((clock) => {
    // Off before the call: one 250-ms window (over the 200-ms window budget).
    const off = fakeRule(clock, 'tắt', 250)
    captureLogs(() => testModerationRegexes([off.rule], 'x'))
    assert.equal(isModerationRuleDisabled('tắt'), true)
    const hit = fakeRule(clock, 'khớp', 10, true)
    const a = fakeRule(clock, 'a', 100)
    const b = fakeRule(clock, 'b', 100)
    const budget = createModerationRegexBudget(250)
    // Fake clock from the call's start: 'khớp' 0→10; 'quét đủ' a 10→110, b 110→210; 'vượt mà xong'
    // starts at 210 < 250, ends at 310 (kept); then the deadline: the last two are never judged.
    const { value, lines } = captureLogs(() => scanModerationRegexBatch([
      { rules: [off.rule], text: 'chỉ luật đang tắt' },
      { rules: [hit.rule, a.rule], text: 'khớp sớm' },
      { rules: [a.rule, b.rule], text: 'quét đủ' },
      { rules: [a.rule], text: 'vượt mà xong' },
      { rules: [b.rule], text: 'hết hạn trước nó' },
      { rules: [a.rule, b.rule], text: 'không tới lượt' },
      { rules: [], text: 'không có luật' },
    ], { stopAtFirstMatch: true, budget }))
    assert.deepEqual(value.hits, [[false], [true, false], [false, false], [false], [false], [false, false], []])
    assert.deepEqual(value.unscanned, [false, false, false, false, true, true, false])
    assert.equal(events(lines, 'ai_moderation.request_budget_exhausted').length, 1)
    // Without a budget nothing is ever cut: nothing is unscanned.
    assert.deepEqual(scanModerationRegexBatch([{ rules: [a.rule, b.rule], text: 'không hạn mức' }]).unscanned, [false])
  })
})

test('a regex pass that THROWS keeps the keyword decisions of the whole batch; texts only regex rules judge are unscanned, and it is logged', async () => {
  reset([rule('lô\\s*đề'), rule('cá độ', 'keyword')])
  freezeClock()
  const original = RegExp.prototype.test
  const throwing = mock.method(RegExp.prototype, 'test', function (this: RegExp, input: string) {
    if (this.source === 'lô\\s*đề') throw new RangeError('Maximum call stack size exceeded')
    return original.call(this, input)
  })
  const lines: LogLine[] = []
  const logs = mock.method(console, 'error', (line: unknown) => { try { lines.push(JSON.parse(String(line)) as LogLine) } catch { /* not a log line */ } })
  let matches: unknown
  let withheld = new Set<string>()
  try {
    matches = await worker.matchInstantRuleBatch(['có kèo cá độ', 'chơi lô đề', 'bình thường'])
    withheld = await worker.earlierTurnsToWithhold(['có kèo cá độ', 'chơi lô đề', 'bình thường', 'mày dcm'])
  } finally {
    logs.mock.restore()
    throwing.mock.restore()
    reset([])
  }
  assert.deepEqual(matches, [{ category: 'cat-cá độ', severity: 'high', label: 'Từ khóa: cá độ' }, null, null], 'the keyword hit survives the thrown regex pass (it was null for the whole batch)')
  assert.deepEqual([...withheld].sort(), ['bình thường', 'chơi lô đề', 'có kèo cá độ', 'mày dcm'].sort(), 'keyword and built-in hits, and the texts the regex rule never judged')
  assert.equal(events(lines, 'ai_moderation.instant_regex_failed').length, 2, 'one line per failed pass, not silent')
})

// ── Attribution: S1 (cut between windows), S2 (stalled pass) ────────────────

test('S1 + S2: an interrupt that lands BETWEEN windows (the rule already answered) blames nobody; a pass that never reaches a window is logged', () => {
  fresh()
  let firstCalls = 0
  const answered = { pattern: 'đã-trả-lời', regex: { test: () => { firstCalls += 1; return true } } as unknown as RegExp }
  // Reading this rule's regex blocks: the timer fires while `job.at` still points at the rule
  // before it, which already has its answer — nobody ran 200 ms of matching.
  const stuck = { pattern: 'kẹt', get regex(): RegExp { const end = performance.now() + 300; while (performance.now() < end); return /x/iu } }
  const started = performance.now()
  const { value: scan, lines } = captureLogs(() => withinWallClock(OUTER_BOUND_MS, 'S1', () => scanModerationRegexBatch([{ rules: [answered, stuck], text: 'x' }])))
  assert.ok(performance.now() - started < 3 * MODERATION_RULE_WINDOW_BUDGET_MS + 300)
  assert.deepEqual(scan.hits, [[true, false]], 'the answered rule keeps its match')
  assert.deepEqual(scan.unscanned, [true], 'the rule it gave up on never judged the text: unscanned, not clean')
  assert.equal(firstCalls, 1)
  assert.equal(isModerationRuleDisabled('đã-trả-lời'), false, 'not blamed for the time after its window')
  assert.deepEqual(events(lines, 'ai_moderation.rule_slow_disabled'), [])
  assert.deepEqual(events(lines, 'ai_moderation.rule_scan_stalled').map(line => [line.pattern, line.inputLength]), [['kẹt', 1]], 'giving up is logged, not silent')
  fresh()
})

test('S3: no window is ever run twice — a counting rule after a heavy one and after a catastrophic one runs exactly once', () => {
  fresh()
  let counted = 0
  const counter = { pattern: 'đếm', regex: { test: (s: string) => { counted += 1; return s.includes('lô đề') } } as unknown as RegExp }
  const bad = '日*日*日*$'
  const rules = [busyRule('nặng', 120), { pattern: bad, regex: compileModerationRegex(bad)! }, counter, busyRule('nặng-2', 120), counter]
  const { value: hits } = captureLogs(() => withinWallClock(OUTER_BOUND_MS, 'S3', () => testModerationRegexes(rules, `${'日'.repeat(1500)}! lô đề`)))
  assert.deepEqual(hits, [false, false, true, false, true])
  assert.equal(counted, 2, 'once per rule entry, never re-run after an interrupt')
  fresh()
})

test('a pass that has run > 20 ms yields before the next window: the catastrophic rule in the middle of 16 is cut once, in ~one window budget', () => {
  fresh()
  const patterns = REAL_RULES.concat(REAL_RULES, REAL_RULES)
  const bad = '日*日*日*$'
  const badRegex = compileModerationRegex(bad)!
  let badWindows = 0
  const rules = [...patterns.slice(0, 7), bad, ...patterns.slice(7)].map(pattern => (pattern === bad
    ? { pattern, regex: { test: (s: string) => { badWindows += 1; return badRegex.test(s) } } as unknown as RegExp }
    : { pattern, regex: compileModerationRegex(pattern)! }))
  const text = `${'日'.repeat(1500)}!`
  // V8 compiles a regex to native code on its first long subject (a few ms each): do it first,
  // or the 7 rules before the bad one can pass 20 ms and yield — one pass more, same bound.
  for (let i = 0; i < 2; i += 1) testModerationRegexes(rules.filter(r => r.pattern !== bad), text)
  const started = performance.now()
  const { value, passes } = vmPasses(() => captureLogs(() => withinWallClock(OUTER_BOUND_MS, 'middle', () => testModerationRegexes(rules, text))))
  const wallMs = performance.now() - started
  assert.equal(badWindows, 1, 'cut once, blamed, never re-run (it was 2: cut, re-run, cut again)')
  // 2: the pass cut at the bad rule, then the rest; 3 only if a stall made the rules before it pass 20 ms.
  assert.ok(passes === 2 || passes === 3, `${passes} passes`)
  assert.ok(wallMs < MODERATION_RULE_WINDOW_BUDGET_MS + 150, `${wallMs.toFixed(0)} ms`)
  assert.deepEqual(events(value.lines, 'ai_moderation.rule_slow_disabled').map(line => [line.pattern, line.reason, line.interrupted]), [[bad, 'window', true]])
  fresh()
})

// ── The chat endpoints: one pass for the whole history ──────────────────────

for (const [name, handler] of HANDLERS) {
  test(`${name}: 30 user turns, regex rules on — the history is matched in ONE vm pass (the new question in its own)`, async () => {
    reset(REAL_RULES.map(pattern => rule(pattern)))
    freezeClock()
    const history = Array.from({ length: 30 }, (_, i) => ({ role: 'user', content: `câu hỏi số ${i} về thủ tục hành chính` }))
    const spy = mock.method(vm.Script.prototype, 'runInContext')
    try {
      await send(handler, history)
      assert.equal(spy.mock.callCount(), 2, 'one pass for the newest turn, one for the 29 earlier ones')
    } finally {
      spy.mock.restore()
      reset([])
    }
  })
}

// ── S4: the only script is the constant 'scan(job)' ─────────────────────────

test('vm is not a sandbox: a main-realm function handed to a context reaches `process`, codeGeneration off or not', () => {
  const context = vm.createContext({ fn: () => 1 }, { codeGeneration: { strings: false, wasm: false } })
  assert.throws(() => vm.runInContext("eval('1')", context), /Code generation from strings disallowed/)
  assert.equal(vm.runInContext("fn.constructor('return typeof process')()", context), 'object')
})

const SERVER = new URL('../server/', import.meta.url)
const RUNTIME = 'server/services/moderation-regex-runtime.ts'
const SCAN_SOURCE = 'scan(job)'

/**
 * Every use of `node:vm` under `server/`: only the runtime may import it (default import), and
 * there only `vm.createContext` (code generation off) and `new vm.Script('scan(job)', …)` — a
 * constant. Anything else is a violation: another importer, a named/namespace import, `require`
 * or `import()` of vm, `runInNewContext`/`runInThisContext`/`compileFunction`/`SourceTextModule`,
 * a `Script` whose source is not that literal.
 */
function vmViolations(sources: Map<string, string>): string[] {
  const out: string[] = []
  const isVm = (node: ts.Node | undefined) => !!node && ts.isStringLiteralLike(node) && (node.text === 'vm' || node.text === 'node:vm')
  for (const [file, source] of sources) {
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const where = (node: ts.Node) => `${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`
    let binding: string | null = null
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && isVm(node.moduleSpecifier)) {
        const clause = node.importClause
        if (file !== RUNTIME) out.push(`${where(node)} imports node:vm`)
        else if (!clause?.name || clause.namedBindings) out.push(`${where(node)} imports node:vm other than as a default binding`)
        else binding = clause.name.text
      }
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require')) && isVm(node.arguments[0]))
        out.push(`${where(node)} loads node:vm dynamically`)
      if (binding && ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === binding) {
        const member = node.name.text
        if (member === 'Script') {
          const created = node.parent
          const arg = ts.isNewExpression(created) && created.expression === node ? created.arguments?.[0] : undefined
          if (!arg || !ts.isStringLiteralLike(arg) || arg.text !== SCAN_SOURCE) out.push(`${where(node)} compiles a vm.Script whose source is not the constant '${SCAN_SOURCE}'`)
        } else if (member === 'createContext') {
          if (!/codeGeneration:\s*\{\s*strings:\s*false,\s*wasm:\s*false\s*\}/.test(node.parent.getText(sf))) out.push(`${where(node)} creates a context with code generation on`)
        } else {
          out.push(`${where(node)} uses vm.${member}`)
        }
      }
      if (binding && ts.isIdentifier(node) && node.text === binding && !ts.isPropertyAccessExpression(node.parent) && !ts.isImportClause(node.parent))
        out.push(`${where(node)} passes the vm module around`)
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return out
}

function serverSources(): Map<string, string> {
  const files = readdirSync(SERVER, { recursive: true, encoding: 'utf8' }).filter(file => /\.[cm]?[jt]s$/.test(file))
  return new Map(files.map(file => [`server/${file.split('\\').join('/')}`, readFileSync(new URL(file, SERVER), 'utf8')]))
}

test('S4: under server/, node:vm is used only by the runtime, only to compile the constant script \'scan(job)\'', () => {
  const sources = serverSources()
  assert.ok(sources.get(RUNTIME)?.includes(`new vm.Script('${SCAN_SOURCE}'`), 'the runtime is scanned')
  assert.deepEqual(vmViolations(sources), [])
})

test('S4 guard goes red on every way around it', () => {
  const runtime = serverSources().get(RUNTIME)!
  const mutate = (from: string, to: string) => {
    assert.ok(runtime.includes(from), `no ${JSON.stringify(from)} to mutate`)
    return new Map([[RUNTIME, runtime.replace(from, to)]])
  }
  const cases: Array<[string, Map<string, string>, RegExp]> = [
    ['data in the script source', mutate(`new vm.Script('${SCAN_SOURCE}'`, 'new vm.Script(`scan(${JSON.stringify(1)})`'), /source is not the constant/],
    ['another constant', mutate(`new vm.Script('${SCAN_SOURCE}'`, "new vm.Script('scan(job); 1'"), /source is not the constant/],
    ['runInNewContext', mutate('scanScript.runInContext(scanContext, { timeout })', "vm.runInNewContext('1', {})"), /uses vm\.runInNewContext/],
    ['code generation on', mutate('codeGeneration: { strings: false, wasm: false }', 'codeGeneration: { strings: true, wasm: false }'), /code generation on/],
    ['namespace import', mutate("import vm from 'node:vm'", "import * as vm from 'node:vm'"), /other than as a default binding/],
    ['vm passed around', mutate('const isScriptTimeout', 'export const leak = vm\nconst isScriptTimeout'), /passes the vm module around/],
    ['another file', new Map([['server/utils/x.ts', "import { runInThisContext } from 'node:vm'\nrunInThisContext('1')\n"]]), /server\/utils\/x\.ts:1 imports node:vm/],
    ['dynamic import', new Map([['server/utils/x.ts', "export const load = () => import('node:vm')\n"]]), /loads node:vm dynamically/],
    ['require', new Map([['server/utils/x.ts', "const vm = require('vm')\n"]]), /loads node:vm dynamically/],
  ]
  for (const [label, sources, expected] of cases) {
    const violations = vmViolations(sources)
    assert.ok(violations.some(violation => expected.test(violation)), `${label}: ${JSON.stringify(violations)}`)
  }
})
