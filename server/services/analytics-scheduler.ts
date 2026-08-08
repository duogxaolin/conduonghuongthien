import { createAnalyticsPool, runAnalyticsMaintenance, utcDay, type MaintenanceResult } from './analytics-maintenance'
import { logInfo, logWarn, logError } from '../utils/logger'

/**
 * In-process scheduler for analytics aggregation and purge.
 *
 * `runAnalyticsMaintenance` already existed but only ran from
 * `npm run analytics:maintenance`, i.e. only if an operator remembered to install
 * a crontab line. That made analytics the last periodic job in the project still
 * depending on someone's memory — retention and view-boost both grew in-process
 * schedulers, analytics did not.
 *
 * The failure mode is the reason this exists, and it is silent: raw rows in
 * `analytics_page_view_events` are only deleted *inside* a maintenance pass, after
 * they have been folded into the daily tables. Miss the cron line and the portal
 * keeps serving, the dashboard keeps showing numbers, and the raw table grows
 * without bound until the disk fills and MySQL stops. On the 1–2 GB VPS this
 * project targets, that is a real outage arriving with no warning attached.
 *
 * Deliberately thin. Everything that makes a concurrent run safe already lives in
 * `analytics-maintenance`:
 *
 *   • the MySQL named lock `cdkt:analytics:maintenance` is taken by the pass
 *     itself, so cron, several replicas and this timer cannot overlap — whichever
 *     arrives second gets `status: 'locked'` and does nothing;
 *   • `analytics_maintenance_runs` records the day each pass completed, so a
 *     restart loop cannot re-aggregate on every boot.
 *
 * Reimplementing either here would mean a second copy of a rule that is only
 * compared against the first when something has already gone wrong.
 */

/** How often the clock is checked. Fifteen minutes is well inside any hour. */
export const TICK_INTERVAL_MS = 15 * 60 * 1000

/**
 * The hour the nightly pass targets, matching the crontab line documented in
 * CLAUDE.md (`0 3 * * *`). Local hour on purpose: it is the server's idea of 3am,
 * the same basis the retention settings page uses.
 */
export const DEFAULT_RUN_HOUR = 3

/**
 * A completed run older than this means the hour was missed entirely — the box was
 * off, or the deployment is new. Past one full daily cycle but short of two, so a
 * single missed night is caught up on the next tick rather than waiting a day.
 */
export const STALE_RUN_MS = 36 * 60 * 60 * 1000

/**
 * The local calendar day of a moment, as `YYYY-MM-DD`.
 *
 * Not `toISOString().slice(0, 10)` — that is the UTC day, which is what made the
 * first version of this scheduler skip every night at UTC+7.
 */
function localDay(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export type DueReason = 'hour-match' | 'never-run' | 'stale' | 'not-due'

export type DueDecision = { due: boolean; reason: DueReason }

/**
 * Pure: given the clock and the last completed run, should a pass happen now?
 *
 * Separated from the timer for the same reason `isRunDue` is in
 * retention-scheduler: a schedule that can only be exercised by waiting for
 * wall-clock time is a schedule nobody tests.
 *
 * `lastCompletedDay` is the `YYYY-MM-DD` string from `analytics_maintenance_runs`,
 * which is a **UTC** day (the aggregation keys on UTC days throughout).
 *
 * ⚠️ The "already done today" check compares LOCAL days, not UTC days, and the
 * difference is not cosmetic. This server runs at UTC+7, where every local hour
 * before 07:00 still falls on the *previous* UTC day — so at 03:00 local on the
 * 8th, `utcDay(now)` is `2026-08-07`. Comparing that against a run the previous
 * night (which wrote `2026-08-07`) reads as "today is already done", and the
 * nightly pass is skipped **every single night**, forever, with nothing in the log
 * saying so. That is the exact silent failure this scheduler was written to end,
 * reintroduced one line lower. Measured, not reasoned about: the first version of
 * this function did compare UTC days and its own tests caught it.
 *
 * So both halves of the decision are local: the hour because it is a human choice
 * about when load is low, and the day because it has to agree with that hour. The
 * stored value is converted to a local day for the comparison.
 */
export function isMaintenanceDue(
  now: Date,
  lastCompletedDay: string | null,
  lastCompletedAt: Date | null = null,
  runHour: number = DEFAULT_RUN_HOUR,
): DueDecision {
  // Never run: go immediately rather than waiting for the hour. The first pass on
  // a deployment is usually the one with a backlog to fold in, and making it wait
  // up to 24 hours is the opposite of what a new deployment needs.
  if (!lastCompletedDay) return { due: true, reason: 'never-run' }

  if (lastCompletedAt && now.getTime() - lastCompletedAt.getTime() >= STALE_RUN_MS) {
    return { due: true, reason: 'stale' }
  }

  if (now.getHours() !== runHour) return { due: false, reason: 'not-due' }

  /**
   * Already ran during today's local day? Without this a restart inside the run
   * hour would aggregate again on every boot.
   *
   * `completed_at` is preferred because it is an instant and converts to a local
   * day exactly. It can be null on an older row, so the stored UTC day is the
   * fallback — and it is compared against BOTH the local and the UTC day of `now`.
   * Comparing only one is how this went wrong the first time: UTC-only skips every
   * night east of UTC, and local-only would let a row written just after UTC
   * midnight trigger a second pass. Accepting either match means the anti-repeat
   * guard errs toward "already done", which costs at most one night of aggregation
   * that the stale branch then picks up — the opposite error re-aggregates on every
   * single boot.
   */
  if (lastCompletedAt) {
    if (localDay(lastCompletedAt) === localDay(now)) return { due: false, reason: 'not-due' }
  } else if (lastCompletedDay === localDay(now) || lastCompletedDay === utcDay(now)) {
    return { due: false, reason: 'not-due' }
  }

  return { due: true, reason: 'hour-match' }
}

/**
 * The most recent successfully completed maintenance day, or null.
 *
 * Reads `status = 'complete'` only: a row left behind by a failed or half-finished
 * pass must not read as "today is done", or one failure would skip a day of
 * aggregation permanently.
 */
export async function lastCompletedMaintenance(): Promise<{ day: string | null; completedAt: Date | null }> {
  const pool = createAnalyticsPool()
  try {
    const [rows] = await pool.query(
      'SELECT day, completed_at FROM analytics_maintenance_runs WHERE status = \'complete\' ORDER BY day DESC LIMIT 1',
    )
    const row = (rows as Array<{ day?: unknown; completed_at?: unknown }>)[0]
    if (!row?.day) return { day: null, completedAt: null }
    const day = row.day instanceof Date ? utcDay(row.day) : String(row.day).slice(0, 10)
    const completedAt = row.completed_at instanceof Date
      ? row.completed_at
      : (row.completed_at ? new Date(String(row.completed_at)) : null)
    return { day, completedAt }
  } finally {
    await pool.end().catch(() => {})
  }
}

export type RunOutcome =
  | { ran: false; reason: DueReason }
  | { ran: true; result: MaintenanceResult }

export type RunPassOptions = {
  /** Skip the clock checks. For cron, whose schedule is the crontab line. */
  ignoreSchedule?: boolean
  trigger?: 'scheduler' | 'cron'
  now?: Date
}

/**
 * One pass, gated on the schedule unless told otherwise.
 *
 * There is deliberately no `force` and no on/off switch of its own. Retention has
 * both because an operator configures its windows in the admin and can turn the
 * purge off; analytics maintenance has no such setting — it is bookkeeping the
 * portal owes its own tables, and "off" means the raw table grows until the disk
 * fills. The only supported way to hand the job back to cron is the
 * ANALYTICS_SCHEDULER environment variable, which stops the timer rather than
 * pretending a pass ran.
 */
export async function runAnalyticsMaintenancePass(options: RunPassOptions = {}): Promise<RunOutcome> {
  const now = options.now ?? new Date()
  const trigger = options.trigger ?? 'scheduler'

  if (!options.ignoreSchedule) {
    const { day, completedAt } = await lastCompletedMaintenance()
    const decision = isMaintenanceDue(now, day, completedAt)
    if (!decision.due) return { ran: false, reason: decision.reason }
  }

  const result = await runAnalyticsMaintenance({ now })

  const fields = {
    event: 'analytics.maintenance_run',
    trigger,
    status: result.status,
    processedDays: result.processedDays,
    purgedRaw: result.purgedRaw,
    purgedAggregates: result.purgedAggregates,
    lastAggregatedDay: result.lastAggregatedDay,
    stale: result.stale,
  }
  // `locked` is not a problem: it means cron or another replica is already doing
  // this work, which is the lock behaving correctly.
  if (result.status === 'failed') logError({ ...fields, message: result.message })
  else if (result.status === 'warning') logWarn({ ...fields, message: result.message })
  else logInfo(fields)

  return { ran: true, result }
}

let timer: ReturnType<typeof setInterval> | null = null

/**
 * Start ticking. Idempotent, and `unref()`ed so the timer never holds the process
 * open — aggregation is not worth delaying a shutdown for.
 */
export function startAnalyticsScheduler(): void {
  if (timer) return

  const tick = () => {
    runAnalyticsMaintenancePass({ trigger: 'scheduler' }).catch((error) => {
      // Swallowed on purpose, same as the retention scheduler: an unhandled
      // rejection in a worker turns one missed pass into an outage. The next tick
      // tries again, and the failure is in the log either way.
      logError({
        event: 'analytics.scheduler_failed',
        message: error instanceof Error ? error.message : String(error),
      })
    })
  }

  timer = setInterval(tick, TICK_INTERVAL_MS)
  timer.unref?.()
  // Deferred: at boot the database may not be reachable yet and init/seed are
  // still running. Longer than retention's 60s because this pass is heavier and
  // there is no reason for both to land at once on a small box.
  const warmup = setTimeout(tick, 90_000)
  warmup.unref?.()
}

export function stopAnalyticsScheduler(): void {
  if (!timer) return
  clearInterval(timer)
  timer = null
}
