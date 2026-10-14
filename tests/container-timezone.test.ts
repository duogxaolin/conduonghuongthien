/**
 * What `TZ=Asia/Ho_Chi_Minh` on the app container actually changes.
 *
 * `tests/analytics-scheduler.test.ts` and `tests/retention-policy.test.ts` build
 * their clocks from LOCAL hours, so they pass in every timezone — which is their
 * point, and also why they cannot show that the container setting does anything.
 * This file pins absolute instants instead and evaluates the real scheduler
 * functions in child processes started with an explicit TZ: once as the image
 * now runs (Asia/Ho_Chi_Minh), once as it used to run (UTC, node:alpine's
 * default with no TZ set).
 *
 * The production consequence being pinned: with no TZ, the nightly "03:00"
 * analytics and retention passes ran at 03:00 UTC = 10:00 Vietnam time, in the
 * middle of the working day.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { describe, it } from 'node:test'

const RESOLVER = new URL('../scripts/ts-resolver.mjs', import.meta.url).href
const ANALYTICS = new URL('../server/services/analytics-scheduler.ts', import.meta.url).href
const RETENTION = new URL('../server/services/retention-scheduler.ts', import.meta.url).href

interface Case {
  /** Absolute instant, always written with Z. */
  now: string
  /** Last completed run, as an absolute instant. */
  lastAt: string
}

interface Decision {
  analytics: { due: boolean; reason: string }
  retention: { due: boolean; reason: string }
}

/**
 * Evaluate both schedulers for each case inside `node` running with `TZ=tz`.
 * The analytics pass gets the UTC day of the last run as its stored day, which
 * is what `analytics_maintenance_runs` holds.
 */
function decide(tz: string, cases: Case[]): Decision[] {
  const program = `
    const { isMaintenanceDue } = await import(${JSON.stringify(ANALYTICS)})
    const { isRunDue } = await import(${JSON.stringify(RETENTION)})
    const cases = JSON.parse(process.argv[1])
    const policy = { autoEnabled: true, runHour: 3 }
    const out = cases.map(({ now, lastAt }) => {
      const at = new Date(now)
      const last = new Date(lastAt)
      return {
        analytics: isMaintenanceDue(at, last.toISOString().slice(0, 10), last),
        retention: isRunDue(policy, at, last),
      }
    })
    process.stdout.write(JSON.stringify(out))
  `
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--import', RESOLVER, '--input-type=module', '-e', program, JSON.stringify(cases)],
    { encoding: 'utf8', env: { ...process.env, TZ: tz } },
  )
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout) as Decision[]
}

// The previous night's pass finished 20 hours before `now`: inside the 36-hour
// stale window, so each case exercises the hour/day branch and not catch-up.
const twentyHoursBefore = (iso: string) => new Date(Date.parse(iso) - 20 * 3_600_000).toISOString()
const at = (now: string): Case => ({ now, lastAt: twentyHoursBefore(now) })

const THREE_AM_VN = at('2026-08-07T20:00:00Z') // 03:00 on the 8th in Vietnam
const FIVE_PM_VN = at('2026-08-08T10:00:00Z') // 17:00 on the 8th in Vietnam
const THREE_AM_UTC = at('2026-08-08T03:00:00Z') // 10:00 on the 8th in Vietnam

describe('nightly passes under the container timezone', () => {
  it('fire at 03:00 Vietnam time with TZ=Asia/Ho_Chi_Minh', () => {
    const [threeAm, fivePm, tenAm] = decide('Asia/Ho_Chi_Minh', [THREE_AM_VN, FIVE_PM_VN, THREE_AM_UTC])
    assert.deepEqual(threeAm!.analytics, { due: true, reason: 'hour-match' })
    assert.deepEqual(threeAm!.retention, { due: true, reason: 'hour-match' })
    assert.deepEqual(fivePm!.analytics, { due: false, reason: 'not-due' })
    assert.deepEqual(fivePm!.retention, { due: false, reason: 'not-due' })
    // Mid-morning is no longer a run hour.
    assert.equal(tenAm!.analytics.due, false)
    assert.equal(tenAm!.retention.due, false)
  })

  it('fired at 10:00 Vietnam time in a UTC container — the reason TZ is set', () => {
    const [threeAmVn, , tenAmVn] = decide('UTC', [THREE_AM_VN, FIVE_PM_VN, THREE_AM_UTC])
    assert.equal(threeAmVn!.analytics.due, false, 'a UTC process does not see 03:00 VN as the run hour')
    assert.deepEqual(tenAmVn!.analytics, { due: true, reason: 'hour-match' })
    assert.deepEqual(tenAmVn!.retention, { due: true, reason: 'hour-match' })
  })
})
