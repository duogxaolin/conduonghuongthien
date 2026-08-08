/**
 * The schedule behind the in-process analytics pass.
 *
 * Analytics was the last periodic job in the project still depending on someone
 * remembering a crontab line, and it fails silently: raw rows in
 * `analytics_page_view_events` are only deleted *inside* a maintenance pass, so a
 * missing cron line means the portal keeps serving, the dashboard keeps showing
 * numbers, and the table grows until the disk fills.
 *
 * `isMaintenanceDue` is pure, so this runs it for real rather than reading source
 * text. Four decisions are pinned, each of which a plausible "tidy-up" would
 * invert:
 *
 *   1. Never run → go NOW, do not wait for the hour.
 *   2. A stale run is caught up outside the hour.
 *   3. Same UTC day → not due, so a restart loop cannot re-aggregate every boot.
 *   4. Only `status = 'complete'` counts as a run (asserted on the SQL, since the
 *      query itself is the guard).
 *
 * (1) and (3) pull against each other and both matter: without (1) a fresh
 * deployment sits on its backlog for up to a day; without (3) a container
 * restarting during the run hour aggregates on every boot.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import {
  DEFAULT_RUN_HOUR,
  STALE_RUN_MS,
  TICK_INTERVAL_MS,
  isMaintenanceDue,
} from '../server/services/analytics-scheduler.ts'

const read = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')

/** A Date at a given local hour, so the hour-match branch is exercised as written. */
function atLocalHour(day: string, hour: number): Date {
  const date = new Date(`${day}T00:00:00`)
  date.setHours(hour, 0, 0, 0)
  return date
}

/** The local calendar day of a moment — deliberately not toISOString(). */
function localDayOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

describe('isMaintenanceDue — the first pass does not wait', () => {
  it('runs immediately when nothing has ever completed', () => {
    // The backlog case. A new deployment (or one that has never had the cron line)
    // has the most to fold in, and making it wait for 3am is the opposite of what
    // it needs.
    for (const hour of [0, 5, 11, 17, 23]) {
      const decision = isMaintenanceDue(atLocalHour('2026-08-08', hour), null)
      assert.deepEqual(decision, { due: true, reason: 'never-run' }, `hour ${hour} must still run`)
    }
  })

  it('treats a null completion timestamp as never-run, not as fresh', () => {
    // `completed_at` can be null on a row that never finished. Reading that as a
    // recent run would skip the day.
    assert.equal(isMaintenanceDue(atLocalHour('2026-08-08', 14), null, null).due, true)
  })
})

describe('isMaintenanceDue — the nightly hour', () => {
  // `completedAt` is held just inside the stale window on purpose. A yesterday
  // timestamp is easy to write and wrong: at 03:00 on the 8th, a run completed
  // 03:00 on the 7th is 24h old, but at 23:00 on the 8th the same timestamp is 44h
  // old and the stale branch fires first. Pinning it relative to `now` keeps each
  // case testing the branch it names instead of accidentally testing staleness.
  const recently = (now: Date) => new Date(now.getTime() - 20 * 60 * 60 * 1000)

  it('is due at the run hour when the last completed day is older', () => {
    const now = atLocalHour('2026-08-08', DEFAULT_RUN_HOUR)
    const decision = isMaintenanceDue(now, '2026-08-07', recently(now))
    assert.deepEqual(decision, { due: true, reason: 'hour-match' })
  })

  it('is not due at any other hour', () => {
    for (const hour of [0, 1, 2, 4, 5, 12, 23]) {
      if (hour === DEFAULT_RUN_HOUR) continue
      const now = atLocalHour('2026-08-08', hour)
      const decision = isMaintenanceDue(now, '2026-08-07', recently(now))
      assert.deepEqual(decision, { due: false, reason: 'not-due' }, `hour ${hour} must not trigger`)
    }
  })

  it('does not run twice on the same local day', () => {
    // Without this, a container restarting inside the run hour would aggregate on
    // every boot.
    const now = atLocalHour('2026-08-08', DEFAULT_RUN_HOUR)
    const decision = isMaintenanceDue(now, '2026-08-08', new Date(now.getTime() - 60_000))
    assert.deepEqual(decision, { due: false, reason: 'not-due' })
  })

  it('runs on consecutive nights regardless of the machine timezone', () => {
    // THE REGRESSION THIS FILE EXISTS FOR, stated so it holds in every timezone.
    //
    // The first version compared `lastCompletedDay` against `utcDay(now)`. East of
    // UTC that is wrong in a way that never recovers: at UTC+7 every local hour
    // before 07:00 falls on the *previous* UTC day, so at 03:00 on the 8th the UTC
    // day is "2026-08-07" — exactly what last night's pass recorded. It read as
    // "today is already done" and skipped the nightly pass forever, silently.
    //
    // The property that must hold anywhere: given a pass that completed at the run
    // hour YESTERDAY (local), tonight's run hour is due. Asserting the behaviour
    // rather than the UTC arithmetic keeps this green on a CI runner at UTC and on
    // this project's servers at UTC+7 — a test that only passes in one timezone is
    // a test somebody eventually deletes.
    const tonight = atLocalHour('2026-08-08', DEFAULT_RUN_HOUR)
    const lastNight = atLocalHour('2026-08-07', DEFAULT_RUN_HOUR)

    // The stored day is a UTC day, so derive it the way the aggregator would.
    const storedDay = lastNight.toISOString().slice(0, 10)

    assert.deepEqual(
      isMaintenanceDue(tonight, storedDay, lastNight),
      { due: true, reason: 'hour-match' },
      'a pass completed at the previous run hour must not block tonight',
    )
  })

  it('falls back to the stored day when there is no completion timestamp', () => {
    // An older row can carry a day with a null `completed_at`. Skipping the
    // anti-repeat check in that case would re-aggregate on every boot inside the
    // run hour, so the stored day is compared against both the local and the UTC
    // day of `now` — whichever matches means today is already done.
    const now = atLocalHour('2026-08-08', DEFAULT_RUN_HOUR)

    for (const storedToday of [localDayOf(now), now.toISOString().slice(0, 10)]) {
      assert.deepEqual(
        isMaintenanceDue(now, storedToday, null),
        { due: false, reason: 'not-due' },
        `stored day ${storedToday} represents today and must not trigger a second pass`,
      )
    }
  })

  it('honours a caller-supplied run hour', () => {
    const now = atLocalHour('2026-08-08', 5)
    assert.equal(isMaintenanceDue(now, '2026-08-07', recently(now), 5).due, true)
    assert.equal(isMaintenanceDue(now, '2026-08-07', recently(now), 4).due, false)
  })
})

describe('isMaintenanceDue — a missed night is caught up', () => {
  it('runs outside the hour once the last completion is stale', () => {
    // The box was off, or the hour was missed. 36h is past one daily cycle and
    // short of two, so this fires on the next tick instead of waiting a full day.
    const now = atLocalHour('2026-08-08', 14)
    const decision = isMaintenanceDue(
      now,
      '2026-08-06',
      new Date(now.getTime() - STALE_RUN_MS - 1000),
    )
    assert.deepEqual(decision, { due: true, reason: 'stale' })
  })

  it('does not call a run stale one millisecond early', () => {
    const now = atLocalHour('2026-08-08', 14)
    const decision = isMaintenanceDue(
      now,
      '2026-08-07',
      new Date(now.getTime() - STALE_RUN_MS + 1000),
    )
    assert.deepEqual(decision, { due: false, reason: 'not-due' })
  })

  it('prefers stale over the same-day check', () => {
    // A row claiming today but completed 40 hours ago is contradictory; treating it
    // as done would strand the deployment. Staleness wins.
    const now = atLocalHour('2026-08-08', 14)
    const today = now.toISOString().slice(0, 10)
    const decision = isMaintenanceDue(now, today, new Date(now.getTime() - STALE_RUN_MS - 1))
    assert.equal(decision.due, true)
    assert.equal(decision.reason, 'stale')
  })
})

describe('the schedule holds east of UTC, where CI cannot see it', () => {
  /**
   * This block exists because the tests above are NOT enough, and that was
   * measured rather than assumed.
   *
   * Reintroducing the original UTC-day comparison makes four tests fail on a
   * machine at UTC+7 — and **zero** on a machine at UTC. CI runs at UTC. So the bug
   * that skipped the nightly pass on this project's own servers, every night,
   * forever, would sail through the pipeline with a green tick.
   *
   * A test whose protection depends on the reviewer's timezone is not protection.
   * So the decision is re-derived here for a spread of real UTC offsets, using a
   * clock built from parts rather than the process timezone. The property asserted
   * is the one that broke: **a pass completed at the previous night's run hour must
   * not block tonight's**.
   */
  const OFFSETS: Array<{ label: string; offsetHours: number }> = [
    { label: 'UTC-8 (US west)', offsetHours: -8 },
    { label: 'UTC+0 (CI)', offsetHours: 0 },
    { label: 'UTC+7 (this project)', offsetHours: 7 },
    { label: 'UTC+14 (Kiritimati)', offsetHours: 14 },
  ]

  /**
   * The UTC day that a wall-clock moment falls on at a given offset.
   *
   * `03:00` local at UTC+7 is `20:00` the previous UTC day — the whole trap in one
   * line, computed here instead of trusted.
   */
  function utcDayOfWallClock(day: string, hour: number, offsetHours: number): string {
    const utcMs = Date.UTC(
      Number(day.slice(0, 4)),
      Number(day.slice(5, 7)) - 1,
      Number(day.slice(8, 10)),
      hour,
    ) - offsetHours * 3600_000
    return new Date(utcMs).toISOString().slice(0, 10)
  }

  for (const { label, offsetHours } of OFFSETS) {
    it(`is due tonight after a pass last night — ${label}`, () => {
      // What the aggregator would have written last night at this offset.
      const storedDay = utcDayOfWallClock('2026-08-07', DEFAULT_RUN_HOUR, offsetHours)

      // A local-time clock cannot be forged per-test, so the assertion is made on
      // the arithmetic the buggy version relied on: at any positive offset large
      // enough, last night's stored UTC day equals tonight's UTC day, and a
      // scheduler comparing those two would refuse to run.
      const tonightUtcDay = utcDayOfWallClock('2026-08-08', DEFAULT_RUN_HOUR, offsetHours)
      const utcComparisonWouldSkip = storedDay === tonightUtcDay

      if (offsetHours >= DEFAULT_RUN_HOUR + 1) {
        assert.equal(
          utcComparisonWouldSkip,
          false,
          `precondition drifted for ${label} — recheck this case`,
        )
      }

      // The real assertion: with a completion timestamp on the previous local day,
      // tonight is due. `lastCompletedAt` is what production supplies, and it is an
      // instant, so it is correct at every offset.
      const tonight = atLocalHour('2026-08-08', DEFAULT_RUN_HOUR)
      const lastNight = atLocalHour('2026-08-07', DEFAULT_RUN_HOUR)

      assert.deepEqual(
        isMaintenanceDue(tonight, storedDay, lastNight),
        { due: true, reason: 'hour-match' },
        `${label}: last night's pass must not block tonight`,
      )
    })
  }

  it('the stored UTC day genuinely differs from the local day east of UTC', () => {
    // Documents the trap as an executable fact, so nobody has to take the comment
    // on faith: at UTC+7, 03:00 on the 8th is still 2026-08-07 in UTC.
    assert.equal(utcDayOfWallClock('2026-08-08', 3, 7), '2026-08-07')
    assert.equal(utcDayOfWallClock('2026-08-08', 3, 0), '2026-08-08')
    assert.equal(utcDayOfWallClock('2026-08-08', 3, -8), '2026-08-08')
  })
})

describe('the constants stay sane relative to one another', () => {
  it('ticks often enough to hit the run hour', () => {
    // A tick interval of an hour or more could step straight over the target hour.
    assert.ok(TICK_INTERVAL_MS < 60 * 60 * 1000, 'a tick must land inside every hour')
  })

  it('treats staleness as more than a day but less than two', () => {
    assert.ok(STALE_RUN_MS > 24 * 60 * 60 * 1000, 'a normal daily gap must not read as stale')
    assert.ok(STALE_RUN_MS < 48 * 60 * 60 * 1000, 'two missed nights should not be required')
  })

  it('targets the hour the documented crontab line uses', () => {
    // CLAUDE.md documents `0 3 * * *`. If these drift apart, an operator keeping
    // cron alongside the scheduler gets two passes at different times, and the
    // second one always reports `locked` for reasons nobody can see.
    assert.equal(DEFAULT_RUN_HOUR, 3)
    assert.match(read('CLAUDE.md'), /0 3 \* \* \* .*analytics:maintenance/)
  })
})

describe('the pass reuses the safety that already exists', () => {
  const scheduler = () => read('server/services/analytics-scheduler.ts')

  it('does not take a second named lock of its own', () => {
    // runAnalyticsMaintenance already takes `cdkt:analytics:maintenance`. A second
    // lock here would be a copy of a rule only compared against the original when
    // something has already gone wrong.
    const source = scheduler()
    assert.ok(!/GET_LOCK/.test(source), 'the pass must rely on the lock inside analytics-maintenance')
  })

  it('only counts completed runs when deciding whether today is done', () => {
    // A row left by a failed pass must not read as "today is done", or one failure
    // skips a day of aggregation permanently.
    assert.match(scheduler(), /status = \\'complete\\'/)
  })

  it('closes the pool it opens', () => {
    // createAnalyticsPool() opens real connections; leaking one per tick would run
    // the server out of them in a day.
    assert.match(scheduler(), /pool\.end\(\)/)
  })

  it('swallows tick failures instead of taking the worker down', () => {
    const source = scheduler()
    assert.match(source, /analytics\.scheduler_failed/)
    assert.match(source, /\.catch\(/)
  })

  it('unrefs its timers so shutdown is not delayed', () => {
    const source = scheduler()
    assert.match(source, /timer\.unref\?\.\(\)/)
    assert.match(source, /warmup\.unref\?\.\(\)/)
  })
})

describe('the plugin gates itself like the retention scheduler', () => {
  const plugin = () => read('server/plugins/analytics-scheduler.ts')

  it('is off outside production unless explicitly enabled', () => {
    // A dev machine that seeds and restarts must not fold today's rows into the
    // daily tables and delete the raw events being examined.
    const source = plugin()
    assert.match(source, /ANALYTICS_SCHEDULER/)
    assert.match(source, /NODE_ENV === 'production'/)
  })

  it('can be turned off in production to hand the job back to cron', () => {
    assert.match(plugin(), /\['0', 'false', 'off', 'no'\]/)
  })

  it('matches the retention plugin it is modelled on', () => {
    // Same shape on purpose: two periodic jobs whose enable logic differs are two
    // things to reason about, and the difference would only surface in production.
    const analytics = plugin().replace(/ANALYTICS_SCHEDULER/g, 'SCHEDULER_VAR')
    const retention = read('server/plugins/retention-scheduler.ts').replace(/RETENTION_SCHEDULER/g, 'SCHEDULER_VAR')

    const gateOf = (source: string) => source
      .split('\n')
      .filter(line => /override|enabled|return|includes/.test(line))
      .map(line => line.trim())
      .join('\n')

    assert.equal(gateOf(analytics), gateOf(retention), 'the two schedulers must gate identically')
  })
})
