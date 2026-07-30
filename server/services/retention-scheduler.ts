import type { Pool, PoolConnection } from 'mysql2/promise'
import { createAnalyticsPool } from './analytics-maintenance'
import { runDataRetention, type DataRetentionResult } from './data-retention'
import { resolveRetentionPolicy, lastRetentionRunAt, type RetentionPolicy } from './retention-policy'
import { logInfo, logWarn, logError } from '../utils/logger'

/**
 * In-process scheduler for the retention purge.
 *
 * The purge already existed but only ran from `npm run analytics:maintenance`,
 * i.e. only if an operator remembered to install a crontab line. Nothing in the
 * product said when that had not happened, so `activity_logs` grew unbounded on
 * every deployment where the line was missed — which is most of them.
 *
 * Two guards make an in-process timer safe here:
 *
 *   • A MySQL named lock (GET_LOCK) is taken for the duration of each run, so
 *     several replicas or a concurrent cron cannot purge at the same time. The
 *     lock is advisory and released when the connection drops, so a killed
 *     container does not wedge it.
 *   • `data_retention_state.last_run_at` decides whether today's run already
 *     happened. Without it a restart loop would purge on every boot.
 *
 * The cron entrypoint stays supported and is still the better choice for a
 * multi-replica deployment; the two cannot collide because of the lock.
 */

const LOCK_NAME = 'cdkt:data:retention'
const LOCK_TIMEOUT_SECONDS = 0

/** How often the hour is checked. Fifteen minutes is well inside any hour. */
export const TICK_INTERVAL_MS = 15 * 60 * 1000

/**
 * A run this old means the scheduled hour was missed entirely — the box was off,
 * or the deployment is new. 36 hours is past one full daily cycle but short of
 * two, so a single missed night is caught up on the next tick.
 */
export const STALE_RUN_MS = 36 * 60 * 60 * 1000

export type DueDecision = { due: boolean; reason: 'hour-match' | 'never-run' | 'stale' | 'disabled' | 'not-due' }

/**
 * Pure: given the policy, the clock and the last run, should a purge happen now?
 *
 * Kept separate from the timer so the schedule is testable without waiting for
 * wall-clock time or standing up a database.
 */
export function isRunDue(policy: RetentionPolicy, now: Date, lastRunAt: Date | null): DueDecision {
  if (!policy.autoEnabled) return { due: false, reason: 'disabled' }
  if (!lastRunAt) return { due: true, reason: 'never-run' }
  if (now.getTime() - lastRunAt.getTime() >= STALE_RUN_MS) return { due: true, reason: 'stale' }

  // Local hour on purpose: an operator picking "3 giờ sáng" means the server's
  // idea of 3am, which is what they see everywhere else in the admin.
  if (now.getHours() !== policy.runHour) return { due: false, reason: 'not-due' }
  const sameLocalDay = lastRunAt.getFullYear() === now.getFullYear()
    && lastRunAt.getMonth() === now.getMonth()
    && lastRunAt.getDate() === now.getDate()
  if (sameLocalDay) return { due: false, reason: 'not-due' }
  return { due: true, reason: 'hour-match' }
}

async function withLock<T>(pool: Pool, action: () => Promise<T>): Promise<T | null> {
  let connection: PoolConnection | null = null
  let held = false
  try {
    connection = await pool.getConnection()
    const [rows] = await connection.query('SELECT GET_LOCK(?, ?) AS acquired', [LOCK_NAME, LOCK_TIMEOUT_SECONDS])
    if (Number((rows as Array<{ acquired?: number }>)[0]?.acquired) !== 1) return null
    held = true
    return await action()
  } finally {
    if (held && connection) await connection.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]).catch(() => undefined)
    connection?.release()
  }
}

export type RunOutcome =
  | { ran: false; reason: DueDecision['reason'] | 'locked' }
  | { ran: true; result: DataRetentionResult }

export type RunPassOptions = {
  /**
   * Skip every check including the on/off switch. For the manual button only:
   * an operator pressing "chạy ngay" has made the decision the switch encodes.
   */
  force?: boolean
  /**
   * Skip the clock checks but still honour the switch. For cron, whose schedule
   * is the crontab line, not `runHour` — but which must stop deleting when an
   * operator turns auto-cleanup off, or the switch is a lie.
   */
  ignoreSchedule?: boolean
  trigger?: 'scheduler' | 'cron' | 'manual'
  now?: Date
}

/**
 * One pass. The lock is taken in every mode, so no combination of scheduler,
 * cron and an impatient operator can purge twice at the same time.
 */
export async function runRetentionPass(options: RunPassOptions = {}): Promise<RunOutcome> {
  const now = options.now ?? new Date()
  const trigger: 'scheduler' | 'cron' | 'manual' = options.trigger ?? 'scheduler'
  const policy = await resolveRetentionPolicy()

  if (!options.force) {
    if (!policy.autoEnabled) return { ran: false, reason: 'disabled' }
    if (!options.ignoreSchedule) {
      const decision = isRunDue(policy, now, await lastRetentionRunAt())
      if (!decision.due) return { ran: false, reason: decision.reason }
    }
  }

  const activity = policy.scopes.find(scope => scope.scope === 'activity_logs')
  const submissions = policy.scopes.find(scope => scope.scope === 'submissions')

  const pool = createAnalyticsPool()
  try {
    const result = await withLock(pool, () => runDataRetention({
      now,
      trigger,
      connection: pool,
      activityLogDays: activity?.days ?? 0,
      activityLogMaxRows: activity?.maxRows ?? 0,
      submissionDays: submissions?.days ?? 0,
      submissionMaxRows: submissions?.maxRows ?? 0,
    }))
    if (!result) return { ran: false, reason: 'locked' }

    const deleted = result.tables.reduce((sum, entry) => sum + entry.deleted, 0)
    const fields = {
      event: 'retention.run',
      trigger,
      status: result.status,
      deleted,
      tables: result.tables.map(entry => ({ table: entry.table, deleted: entry.deleted, bounded: entry.bounded })),
    }
    if (result.status === 'failed') logError({ ...fields, message: result.message })
    else if (result.status === 'warning') logWarn({ ...fields, message: result.message })
    else logInfo(fields)

    return { ran: true, result }
  } finally {
    await pool.end().catch(() => {})
  }
}

let timer: ReturnType<typeof setInterval> | null = null

/**
 * Start ticking. Idempotent, and `unref()`ed so the timer never holds the
 * process open — a purge is not worth delaying a shutdown for.
 */
export function startRetentionScheduler(): void {
  if (timer) return
  const tick = () => {
    runRetentionPass({ trigger: 'scheduler' }).catch((error) => {
      // Swallowed on purpose: a scheduler that throws into an unhandled
      // rejection takes the worker with it, and a missed purge is not worth
      // an outage. The next tick tries again.
      logError({ event: 'retention.scheduler_failed', message: error instanceof Error ? error.message : String(error) })
    })
  }
  timer = setInterval(tick, TICK_INTERVAL_MS)
  timer.unref?.()
  // First pass is deferred: at boot the database may not be reachable yet, and
  // init/seed are still running.
  const warmup = setTimeout(tick, 60_000)
  warmup.unref?.()
}

export function stopRetentionScheduler(): void {
  if (!timer) return
  clearInterval(timer)
  timer = null
}
