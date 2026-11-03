/**
 * A hard wall-clock bound around an ASYNC test body — the counterpart of `withinWallClock`
 * (`tests/_wall-clock-bound.ts`), which bounds one synchronous call with a `vm` timeout but
 * cannot follow the body past its first `await`.
 *
 * `node:test`'s `{ timeout }` is no bound either: its timer only fires when the event loop gets
 * the thread back, and the code under test here (regex matching) blocks it. So the watchdog is
 * a separate thread: a `Worker` with its own event loop sleeps `limitMs`; if the body is still
 * running then, it writes the label straight to stderr (`fs.writeSync` — the main thread may be
 * the one stuck) and SIGKILLs this process. `node --test` runs each file in its own process, so
 * the file fails, loudly, within the bound instead of holding the runner.
 */
import { Worker } from 'node:worker_threads'

const WATCHDOG = `
const { workerData } = require('node:worker_threads')
const { writeSync } = require('node:fs')
setTimeout(() => {
  writeSync(2, '\\nWALL CLOCK EXCEEDED: ' + workerData.label + ' still running after ' + workerData.limitMs + ' ms — the test process is killed by its own bound\\n')
  process.kill(workerData.pid, 'SIGKILL')
}, workerData.limitMs)
`

/** `await run()`, or this process is killed (with `label` on stderr) once it has run `limitMs` ms. */
export async function withinWallClockAsync<T>(limitMs: number, label: string, run: () => Promise<T>): Promise<T> {
  const watchdog = new Worker(WATCHDOG, { eval: true, execArgv: [], workerData: { limitMs, label, pid: process.pid } })
  watchdog.unref()
  try {
    return await run()
  } finally {
    await watchdog.terminate()
  }
}
