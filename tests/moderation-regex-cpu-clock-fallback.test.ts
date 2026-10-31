/**
 * Level 2 of `moderation-regex` charges each window the thread's CPU time
 * (`process.threadCpuUsage`, `moderation-regex-budget.ts`); a runtime WITHOUT that clock falls back
 * to wall time. A runtime where the clock EXISTS but THROWS (libuv `uv_getrusage_thread` failing —
 * a sandboxed or seccomp-filtered thread) was not covered: the read happens inside the `vm` pass,
 * the throw aborted every pass, and every caller failed open — each regex rule skipped on every
 * request, a prohibited comment published without its rule ever running (verify of the wave3
 * 4.3c follow-ups, `cpuclock-throw-node24.log`: `comment(bad) ok=true`,
 * `ai_moderation.instant_regex_failed` on every path). A clock that throws must read as no clock:
 * wall time, the rules still match, and level 2 still disables a slow rule.
 *
 * The clock is replaced BEFORE the moderation modules load (the budget module checks for it once,
 * at load), with one that throws on every call. Real moderation through the real chat handlers
 * and the real worker; database, AI gateway and chat plumbing faked (`_chat-real-moderation.ts`).
 */
import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

const realThreadCpuUsage = process.threadCpuUsage
let clockReads = 0
process.threadCpuUsage = (() => {
  clockReads += 1
  throw Object.assign(new Error('uv_getrusage_thread: ENOTSUP'), { code: 'ERR_OPERATION_FAILED' })
}) as typeof process.threadCpuUsage

const { HANDLERS, kindOf, moderationRegex, reset, rule, send, state, worker } = await import('./_chat-real-moderation.ts')
const { isModerationRuleDisabled, testModerationRegexes, compileModerationRegex } = moderationRegex

/** The JSON log lines (`logWarn` writes them to `console.error`) emitted while `run` runs. */
async function eventsOf<T>(run: () => Promise<T>): Promise<{ value: T, events: string[] }> {
  const events: string[] = []
  const spy = mock.method(console, 'error', (line: unknown) => {
    try { events.push(String((JSON.parse(String(line)) as { event?: unknown }).event)) } catch { /* not a log line */ }
  })
  try {
    return { value: await run(), events }
  } finally {
    spy.mock.restore()
  }
}

test('the stand-in clock is the one the budget module reads, and it throws', () => {
  assert.equal(typeof process.threadCpuUsage, 'function', 'present, so the module does not take its "no clock" branch')
  assert.notEqual(process.threadCpuUsage, realThreadCpuUsage)
  assert.throws(() => process.threadCpuUsage(), /ENOTSUP/)
})

for (const [name, handler] of HANDLERS) {
  test(`${name}: a prohibited newest turn is still refused and queued — the regex rule runs on wall time`, async () => {
    reset([rule('lô\\s*đề')])
    const before = clockReads
    const { value: reply, events } = await eventsOf(() => send(handler, [{ role: 'user', content: 'chơi lô đề ở đâu' }]))
    assert.ok(clockReads > before, 'the throwing clock was consulted — the path under test ran')
    assert.equal(kindOf(reply), 'moderation_blocked')
    assert.equal(state.queue.length, 1, 'one review-queue row for the refused question')
    assert.ok(!events.includes('ai_moderation.instant_regex_failed'), `no regex pass failed: ${events.join(', ')}`)
  })
}

test('the comment path: fastPreModerate blocks, checkAndModerateContent flags — neither fails open', async () => {
  reset([rule('lô\\s*đề')])
  const { value, events } = await eventsOf(async () => ({
    instant: await worker.fastPreModerate('chơi lô đề ở đâu', { targetType: 'comment' }),
    full: await worker.checkAndModerateContent({ content: 'chơi lô đề ở đâu', targetType: 'comment', targetId: 5 }),
  }))
  assert.equal(value.instant.blocked, true)
  assert.equal(value.full.flagged, true)
  assert.ok(!events.includes('ai_moderation.instant_regex_failed'), `no regex pass failed: ${events.join(', ')}`)
})

test('level 2 still bounds a slow rule: its windows are charged wall time, and it is disabled (cumulative)', async () => {
  reset()
  const pattern = 'chậm-cpu-clock'
  const original = RegExp.prototype.test
  let windows = 0
  // 60 ms of busy wall time per window: under the 200-ms window budget, so only the per-rule
  // total (1 s per 60-s period) can stop it.
  const spy = mock.method(RegExp.prototype, 'test', function (this: RegExp, input: string) {
    if (this.source !== pattern) return original.call(this, input)
    windows += 1
    const end = performance.now() + 60
    while (performance.now() < end);
    return false
  })
  try {
    const { events } = await eventsOf(async () => {
      for (let call = 0; call < 40 && !isModerationRuleDisabled(pattern); call += 1) {
        assert.deepEqual(testModerationRegexes([{ pattern, regex: compileModerationRegex(pattern)! }], 'một tin bình thường'), [false])
      }
    })
    assert.equal(isModerationRuleDisabled(pattern), true, `${windows} windows of 60 ms and the rule is still enabled`)
    assert.ok(windows >= 16 && windows <= 18, `disabled after ~1 s of charged time, not before: ${windows} windows`)
    assert.ok(events.includes('ai_moderation.rule_slow_disabled'), events.join(', '))
  } finally {
    spy.mock.restore()
  }
})

test('restore the real clock for whatever runs after this file', () => {
  process.threadCpuUsage = realThreadCpuUsage
  assert.equal(typeof process.threadCpuUsage(), 'object')
})
