/**
 * A hard wall-clock bound around one synchronous call, for tests whose subject can hang.
 *
 * `node:test`'s `{ timeout }` cannot stop a synchronous test body: its timer only fires when
 * the body gives the thread back, so a regex or an analysis loop that runs for minutes runs
 * for minutes, and the whole file is killed by the outer runner instead of failing with a
 * message. `vm`'s `timeout` can: the watchdog thread terminates whatever JavaScript is running
 * — the call below runs in the MAIN realm, its code and its objects unchanged; the context
 * only hosts the one-line script that calls it. Nested bounds work: an inner `vm` timeout
 * (the moderation runtime's own) is caught where it is thrown; this outer one fires only when
 * the inner one is missing.
 *
 * The context and script are made once. The call is handed over as a context property, never
 * as script text.
 */
import vm from 'node:vm'

const context = vm.createContext({ call: null as (() => unknown) | null })
const script = new vm.Script('call()', { filename: 'tests/_wall-clock-bound.ts' })

export class WallClockExceeded extends Error {}

/** `call()`, or a `WallClockExceeded` naming `label` once it has run `limitMs` ms. */
export function withinWallClock<T>(limitMs: number, label: string, call: () => T): T {
  const previous = context.call
  context.call = call
  try {
    return script.runInContext(context, { timeout: limitMs }) as T
  } catch (err: unknown) {
    if ((err as { code?: unknown } | null)?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT')
      throw new WallClockExceeded(`${label}: still running after ${limitMs} ms — stopped by the test's own bound`)
    throw err
  } finally {
    context.call = previous
  }
}
