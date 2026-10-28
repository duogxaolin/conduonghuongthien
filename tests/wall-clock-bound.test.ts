/**
 * The test helpers' own bounds (`tests/_wall-clock-bound.ts`, `tests/_async-wall-clock-bound.ts`):
 * each scenario runs in a child process, because the hard bound kills the process it runs in.
 * The children run concurrently (each mostly waits for its watchdog).
 *
 * The hard bound is what the verify of 4.3c follow-up (W3) found missing: the sync helper's only
 * stop was a `vm` timeout, which a nested `vm` timeout firing at the same moment cancels — a
 * mutant then held a test file for 1 306 s. A call blocked in native code is the deterministic
 * stand-in for "the soft stop never lands": `vm`'s termination only takes effect when JavaScript
 * runs again, so only the watchdog thread can end it.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { KILL_GRACE_MS } from './_wall-clock-bound.ts'

const HELPER = fileURLToPath(new URL('./_wall-clock-bound.ts', import.meta.url))
const ASYNC_HELPER = fileURLToPath(new URL('./_async-wall-clock-bound.ts', import.meta.url))

type ChildRun = { wallMs: number, status: number | null, signal: NodeJS.Signals | null, stdout: string, stderr: string }

/** Run `body` (an ES module source) in a fresh Node process; wall time, exit code/signal, output. */
function child(body: string, timeoutMs = 60_000): Promise<ChildRun> {
  const started = performance.now()
  const proc = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', '--input-type=module', '-e', body], { timeout: timeoutMs })
  let stdout = ''
  let stderr = ''
  proc.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk })
  proc.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk })
  return new Promise((resolve, reject) => {
    proc.on('error', reject)
    proc.on('close', (status, signal) => resolve({ wallMs: performance.now() - started, status, signal, stdout, stderr }))
  })
}

describe('test wall-clock bounds', { concurrency: true }, () => {
  it('withinWallClock: a call stuck where the vm stop cannot land (native code) is killed by the watchdog thread at limit + grace', async () => {
    const run = await child(`
      import { execFileSync } from 'node:child_process'
      import { withinWallClock } from ${JSON.stringify(HELPER)}
      withinWallClock(300, 'native sleep', () => execFileSync('sleep', ['30']))
      process.stdout.write('NOT KILLED')
    `)
    assert.equal(run.signal, 'SIGKILL', JSON.stringify(run))
    assert.doesNotMatch(run.stdout, /NOT KILLED/)
    assert.match(run.stderr, /WALL CLOCK EXCEEDED: native sleep \(bound 300 ms\)/)
    assert.ok(run.wallMs >= 300 + KILL_GRACE_MS - 100, `killed at ${run.wallMs.toFixed(0)} ms — before limit + grace`)
    assert.ok(run.wallMs < 300 + KILL_GRACE_MS + 10_000, `killed at ${run.wallMs.toFixed(0)} ms`)
  })

  it('withinWallClock: a runaway JS loop gets the soft stop (WallClockExceeded) and the process lives on; nothing is killed later', async () => {
    const run = await child(`
      import { withinWallClock, WallClockExceeded, KILL_GRACE_MS } from ${JSON.stringify(HELPER)}
      let caught = ''
      try { withinWallClock(200, 'busy loop', () => { for (;;); }) } catch (err) { caught = err instanceof WallClockExceeded ? 'soft' : String(err) }
      // Disarmed: wait past the old kill deadline, then a bounded call that finishes is fine too.
      await new Promise(resolve => setTimeout(resolve, 200 + KILL_GRACE_MS + 500))
      const value = withinWallClock(1000, 'quick', () => 42)
      process.stdout.write(caught + ' ' + value)
    `)
    assert.equal(run.signal, null, run.stderr)
    assert.equal(run.status, 0, run.stderr)
    assert.equal(run.stdout, 'soft 42')
    assert.doesNotMatch(run.stderr, /WALL CLOCK EXCEEDED/)
  })

  it('withinWallClock: nested calls keep the outer deadline (armed again once the inner call returns)', async () => {
    const run = await child(`
      import { execFileSync } from 'node:child_process'
      import { withinWallClock } from ${JSON.stringify(HELPER)}
      withinWallClock(300, 'outer', () => {
        withinWallClock(60_000, 'inner', () => 1)
        execFileSync('sleep', ['30'])
      })
    `)
    assert.equal(run.signal, 'SIGKILL', JSON.stringify(run))
    assert.match(run.stderr, /WALL CLOCK EXCEEDED: outer \(bound 300 ms\)/)
    assert.ok(run.wallMs < 300 + KILL_GRACE_MS + 10_000, `killed at ${run.wallMs.toFixed(0)} ms`)
  })

  it('withinWallClock: the unref\'d watchdog never holds the process open', async () => {
    const run = await child(`
      import { withinWallClock } from ${JSON.stringify(HELPER)}
      withinWallClock(60_000, 'done', () => 1)
    `)
    assert.equal(run.status, 0, run.stderr)
    assert.ok(run.wallMs < 5000, `the process took ${run.wallMs.toFixed(0)} ms to exit`)
  })

  it('withinWallClockAsync: a body that blocks the event loop is killed at its bound', async () => {
    const run = await child(`
      import { withinWallClockAsync } from ${JSON.stringify(ASYNC_HELPER)}
      await withinWallClockAsync(500, 'blocked body', async () => { const end = Date.now() + 30_000; while (Date.now() < end); })
      process.stdout.write('NOT KILLED')
    `)
    assert.equal(run.signal, 'SIGKILL', JSON.stringify(run))
    assert.match(run.stderr, /WALL CLOCK EXCEEDED: blocked body/)
    assert.ok(run.wallMs < 500 + 10_000, `killed at ${run.wallMs.toFixed(0)} ms`)
  })
})
