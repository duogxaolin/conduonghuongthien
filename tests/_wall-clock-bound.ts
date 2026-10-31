/**
 * A hard wall-clock bound around one synchronous call, for tests whose subject can hang.
 *
 * `node:test`'s `{ timeout }` cannot stop a synchronous test body: its timer only fires when
 * the body gives the thread back, so a regex or an analysis loop that runs for minutes runs
 * for minutes, and the whole file is killed by the outer runner instead of failing with a
 * message. Two bounds, in this order:
 *
 *  1. `vm`'s `timeout` — the soft one, at `limitMs`. The watchdog thread terminates whatever
 *     JavaScript is running and the call throws `WallClockExceeded`: the test fails with a
 *     message and the rest of the file still runs. The call runs in the MAIN realm, its code and
 *     its objects unchanged; the context only hosts the one-line script that calls it (handed
 *     over as a context property, never as script text).
 *
 *     It is NOT a hard bound when the call itself nests a `vm` timeout — the moderation runtime
 *     runs every window in one. A termination carries no owner: when the inner timer and this
 *     one fire together, the inner `runInContext` sees its own timer expired, CANCELS the
 *     termination (both of them — it is one isolate flag) and throws its own timeout, which the
 *     runtime catches as its own; this timer has fired once and never fires again. Verify of
 *     4.3c follow-up, W3: on Node 24 this happened 2 runs in 15, and a mutant that re-runs an
 *     interrupted window (M12) then held `moderation-regex-timeout.test.ts` for 1 306 s.
 *
 *  2. A watchdog THREAD — the hard one, at `limitMs + KILL_GRACE_MS`. The same mechanism as
 *     `withinWallClockAsync` (`tests/_async-wall-clock-bound.ts`): a `Worker` with its own
 *     event loop; if the call is still running at its deadline it writes the label to stderr
 *     (`fs.writeSync` — the main thread is the one stuck) and SIGKILLs this process. Nothing in
 *     the main thread can cancel a SIGKILL. `node --test` runs each file in its own process, so
 *     the file fails, loudly, within the bound; the other files still report.
 *
 * The watchdog is ONE worker per process, started on the first call and unref'd (it never keeps
 * the process alive). Arming and disarming are synchronous — the call blocks the main thread, so
 * no message could reach the worker — through a `SharedArrayBuffer`: an odd `generation` means
 * armed, and the worker times each generation from the moment it sees it (its own clock: a test
 * that fakes `Date` or the timers of the main thread cannot move it). Nested calls re-arm with
 * the earlier of the two deadlines and restore the outer one on the way out.
 */
import vm from 'node:vm'
import { Worker } from 'node:worker_threads'

const context = vm.createContext({ call: null as (() => unknown) | null })
const script = new vm.Script('call()', { filename: 'tests/_wall-clock-bound.ts' })

/** How long after the soft bound the watchdog thread kills the process. */
export const KILL_GRACE_MS = 5000

export class WallClockExceeded extends Error {}

const LABEL_BYTES = 512
/** [0] generation (odd = armed), [1] ms the armed generation may run, [2] label length; then the label (UTF-8). */
const shared = new SharedArrayBuffer(12 + LABEL_BYTES)
const control = new Int32Array(shared, 0, 3)
const labelBytes = new Uint8Array(shared, 12, LABEL_BYTES)

const WATCHDOG = `
const { workerData } = require('node:worker_threads')
const { writeSync } = require('node:fs')
const control = new Int32Array(workerData.shared, 0, 3)
const labelBytes = new Uint8Array(workerData.shared, 12)
let armed = -1
let deadline = 0
for (;;) {
  const generation = Atomics.load(control, 0)
  if ((generation & 1) === 0) { armed = -1; Atomics.wait(control, 0, generation); continue }
  if (generation !== armed) { armed = generation; deadline = performance.now() + Atomics.load(control, 1) }
  const left = deadline - performance.now()
  if (left > 0) { Atomics.wait(control, 0, generation, left); continue }
  if (Atomics.load(control, 0) !== generation) continue
  const label = new TextDecoder().decode(labelBytes.slice(0, Atomics.load(control, 2)))
  writeSync(2, '\\nWALL CLOCK EXCEEDED: ' + label + ' — still running past its bound and its soft vm stop; the test process is killed by its own bound\\n')
  process.kill(workerData.pid, 'SIGKILL')
  Atomics.wait(control, 0, generation)
}
`

let watchdog: Worker | null = null
/** Deadlines (main-thread `performance.now()`) and labels of the calls running now, outermost first. */
const running: Array<{ deadline: number, label: string }> = []

/** Arm the watchdog for the innermost running call: it kills the process at the earliest deadline. */
function arm(): void {
  if (watchdog === null) {
    watchdog = new Worker(WATCHDOG, { eval: true, execArgv: [], workerData: { shared, pid: process.pid } })
    watchdog.unref()
  }
  const now = performance.now()
  const due = running.reduce((earliest, entry) => (entry.deadline < earliest.deadline ? entry : earliest))
  const label = new TextEncoder().encode(due.label).slice(0, LABEL_BYTES)
  labelBytes.set(label)
  Atomics.store(control, 2, label.length)
  Atomics.store(control, 1, Math.max(1, Math.ceil(due.deadline - now)))
  const generation = Atomics.load(control, 0)
  Atomics.store(control, 0, (generation & 1) === 0 ? generation + 1 : generation + 2) // always a NEW odd value
  Atomics.notify(control, 0)
}

function disarm(): void {
  if (running.length > 0) { arm(); return }
  const generation = Atomics.load(control, 0)
  if ((generation & 1) === 1) Atomics.store(control, 0, generation + 1)
  Atomics.notify(control, 0)
}

/**
 * `call()`, or a `WallClockExceeded` naming `label` once it has run `limitMs` ms; if that soft
 * stop is swallowed (see above), this process is killed at `limitMs + KILL_GRACE_MS`.
 */
export function withinWallClock<T>(limitMs: number, label: string, call: () => T): T {
  const previous = context.call
  context.call = call
  running.push({ deadline: performance.now() + limitMs + KILL_GRACE_MS, label: `${label} (bound ${limitMs} ms)` })
  arm()
  try {
    return script.runInContext(context, { timeout: limitMs }) as T
  } catch (err: unknown) {
    if ((err as { code?: unknown } | null)?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT')
      throw new WallClockExceeded(`${label}: still running after ${limitMs} ms — stopped by the test's own bound`)
    throw err
  } finally {
    running.pop()
    disarm()
    context.call = previous
  }
}
