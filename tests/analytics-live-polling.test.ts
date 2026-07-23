import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ANALYTICS_MAX_BACKOFF_SECONDS,
  ANALYTICS_MIN_POLL_SECONDS,
  analyticsConnectionState,
  analyticsPollDelaySeconds,
  createAnalyticsPanelPoller,
  normalizeAnalyticsPollSeconds,
  type AnalyticsPanelPollingState,
} from '../app/utils/analytics-live-polling'

type Response = { nextPollAfterSeconds: number; stale?: boolean; value?: string }
type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

class FakeClock {
  now = 1_000
  nextId = 1
  timers = new Map<number, { at: number; callback: () => void }>()

  setTimer = (callback: () => void, delayMs: number) => {
    const id = this.nextId++
    this.timers.set(id, { at: this.now + delayMs, callback })
    return id as unknown as ReturnType<typeof setTimeout>
  }

  clearTimer = (timer: ReturnType<typeof setTimeout>) => {
    this.timers.delete(timer as unknown as number)
  }

  nextDelay() {
    const next = [...this.timers.values()].sort((a, b) => a.at - b.at)[0]
    return next ? next.at - this.now : null
  }

  advance(ms: number) {
    const destination = this.now + ms
    while (true) {
      const next = [...this.timers.entries()].sort((a, b) => a[1].at - b[1].at)[0]
      if (!next || next[1].at > destination) break
      this.now = next[1].at
      this.timers.delete(next[0])
      next[1].callback()
    }
    this.now = destination
  }
}

function abortError() {
  return Object.assign(new Error('aborted'), { name: 'AbortError' })
}

function flush() {
  return new Promise(resolve => setImmediate(resolve))
}

function harness(request: (signal: AbortSignal) => Promise<Response>) {
  const clock = new FakeClock()
  const states: AnalyticsPanelPollingState[] = []
  const successes: Response[] = []
  const poller = createAnalyticsPanelPoller<Response>({
    request,
    onSuccess: response => successes.push(response),
    isStale: response => Boolean(response.stale),
    onStateChange: state => states.push(state),
    now: () => clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  })
  return { clock, states, successes, poller }
}

test('normalizes server hints and bounds exponential backoff at 15/30/60 seconds', () => {
  assert.equal(normalizeAnalyticsPollSeconds(undefined), ANALYTICS_MIN_POLL_SECONDS)
  assert.equal(normalizeAnalyticsPollSeconds(1), 15)
  assert.equal(normalizeAnalyticsPollSeconds(15.1), 16)
  assert.equal(normalizeAnalyticsPollSeconds(120), ANALYTICS_MAX_BACKOFF_SECONDS)
  assert.deepEqual([0, 1, 2, 3].map(failures => analyticsPollDelaySeconds(15, failures)), [15, 30, 60, 60])
  assert.equal(analyticsPollDelaySeconds(45, 1), 60)
})

test('one controller never overlaps and restart supersedes by aborting only its own request', async () => {
  const requests: Array<{ signal: AbortSignal; work: Deferred<Response> }> = []
  const h = harness((signal) => {
    const work = deferred<Response>()
    requests.push({ signal, work })
    signal.addEventListener('abort', () => work.reject(abortError()), { once: true })
    return work.promise
  })

  h.poller.start()
  h.poller.refresh()
  h.poller.retry()
  assert.equal(requests.length, 1)
  assert.equal(h.poller.snapshot().inFlight, true)

  h.poller.restart(true)
  assert.equal(requests[0]!.signal.aborted, true)
  assert.equal(requests.length, 2)
  requests[1]!.work.resolve({ nextPollAfterSeconds: 15, value: 'new' })
  await flush()
  assert.deepEqual(h.successes.map(item => item.value), ['new'])
  assert.equal(h.poller.snapshot().inFlight, false)
  assert.equal(h.clock.nextDelay(), 15_000)
})

test('separate panel instances isolate failures, success, timers, and disconnected state', async () => {
  let liveCalls = 0
  let breakdownCalls = 0
  const live = harness(async () => ({ nextPollAfterSeconds: 15, value: `live-${++liveCalls}` }))
  const breakdown = harness(async () => { breakdownCalls += 1; throw new Error('breakdown unavailable') })

  live.poller.start()
  breakdown.poller.start()
  await flush()
  assert.equal(live.poller.snapshot().connectionState, 'connected')
  assert.equal(live.poller.snapshot().consecutiveFailures, 0)
  assert.equal(breakdown.poller.snapshot().connectionState, 'partial-error')
  assert.equal(breakdown.poller.snapshot().consecutiveFailures, 1)

  breakdown.clock.advance(30_000)
  await flush()
  breakdown.clock.advance(60_000)
  await flush()
  assert.equal(breakdownCalls, 3)
  assert.equal(breakdown.poller.snapshot().connectionState, 'disconnected')
  assert.equal(live.poller.snapshot().connectionState, 'connected')
  assert.equal(live.clock.nextDelay(), 15_000)
})

test('success resets only that panel failure count and preserves stale classification', async () => {
  const outcomes: Array<Deferred<Response>> = []
  const h = harness(() => {
    const outcome = deferred<Response>()
    outcomes.push(outcome)
    return outcome.promise
  })

  h.poller.start()
  outcomes[0]!.reject(new Error('first'))
  await flush()
  assert.equal(h.poller.snapshot().consecutiveFailures, 1)
  assert.equal(h.clock.nextDelay(), 30_000)

  h.clock.advance(30_000)
  outcomes[1]!.resolve({ nextPollAfterSeconds: 20, stale: true })
  await flush()
  assert.equal(h.poller.snapshot().consecutiveFailures, 0)
  assert.equal(h.poller.snapshot().stale, true)
  assert.equal(h.poller.snapshot().lastSuccessfulAt, h.clock.now)
  assert.equal(h.clock.nextDelay(), 20_000)
  assert.equal(h.poller.snapshot().countdownSeconds, 20)
})

test('pause aborts active work and timers; resume refreshes immediately without counting abort', async () => {
  const requests: Array<{ signal: AbortSignal; work: Deferred<Response> }> = []
  const h = harness((signal) => {
    const work = deferred<Response>()
    requests.push({ signal, work })
    signal.addEventListener('abort', () => work.reject(abortError()), { once: true })
    return work.promise
  })

  h.poller.start()
  assert.equal(requests.length, 1)
  h.poller.pause()
  assert.equal(requests[0]!.signal.aborted, true)
  assert.equal(h.poller.snapshot().paused, true)
  assert.equal(h.poller.snapshot().consecutiveFailures, 0)
  assert.equal(h.clock.timers.size, 0)
  await flush()
  assert.equal(h.poller.snapshot().consecutiveFailures, 0)

  h.poller.resume()
  assert.equal(requests.length, 2)
  assert.equal(h.poller.snapshot().paused, false)
  requests[1]!.work.resolve({ nextPollAfterSeconds: 15 })
  await flush()
  assert.equal(h.clock.nextDelay(), 15_000)
})

test('ordinary abort rejection is ignored and schedules the minimum cadence', async () => {
  const h = harness(async () => { throw abortError() })
  h.poller.start()
  await flush()
  assert.equal(h.poller.snapshot().consecutiveFailures, 0)
  assert.equal(h.poller.snapshot().error, null)
  assert.equal(h.clock.nextDelay(), 15_000)
})

test('401/403 denial clears successful classification and stops scheduling', async () => {
  const h = harness(async () => { throw { statusCode: 403 } })
  h.poller.start()
  await flush()
  assert.equal(h.poller.snapshot().connectionState, 'access-denied')
  assert.equal(h.poller.snapshot().denied, true)
  assert.equal(h.poller.snapshot().hasSuccessfulData, false)
  assert.equal(h.clock.timers.size, 0)
})

test('stop aborts active request, removes timer, and prevents later resume or retry', async () => {
  const work = deferred<Response>()
  let calls = 0
  let signal: AbortSignal | null = null
  const h = harness((requestSignal) => {
    calls += 1
    signal = requestSignal
    requestSignal.addEventListener('abort', () => work.reject(abortError()), { once: true })
    return work.promise
  })

  h.poller.start()
  h.poller.stop()
  assert.equal(signal?.aborted, true)
  assert.equal(h.clock.timers.size, 0)
  h.poller.resume()
  h.poller.retry()
  h.clock.advance(120_000)
  await flush()
  assert.equal(calls, 1)
  assert.equal(h.poller.snapshot().paused, true)
})

test('legacy connection helper remains backward compatible', () => {
  assert.equal(analyticsConnectionState({ hasSuccessfulData: false, loading: true, consecutiveFailures: 0 }), 'loading')
  assert.equal(analyticsConnectionState({ hasSuccessfulData: true, loading: false, consecutiveFailures: 1 }), 'partial-error')
  assert.equal(analyticsConnectionState({ hasSuccessfulData: true, loading: false, consecutiveFailures: 3 }), 'disconnected')
})
