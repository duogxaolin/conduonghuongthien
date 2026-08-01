/**
 * Gradual delivery of administrator-authorised view inflation.
 *
 * Follows `server/services/retention-scheduler.ts` deliberately: pure decision
 * function, MySQL named lock with timeout 0, `unref()`ed timer, deferred first
 * tick, tick errors swallowed into a structured log line. Two schedulers in one
 * codebase with different shapes is a trap for whoever reads them next.
 *
 * The one rule this pass must not break: `started_at` / `ends_at` are read
 * through Drizzle's query builder and nothing else. Both are DATETIME, a type
 * that carries no zone, and Drizzle's two halves are inverses only as a pair —
 * it writes with `toISOString()` (the UTC wall clock) and reads by forcing
 * mysql2 into string mode for DATETIME and re-appending `Z`.
 *
 * A raw `pool.query` skips that string-mode override, so mysql2's own parser
 * applies the pool's own `timezone` to a value Drizzle never encoded in it. On
 * the application pool (`'+07:00'`) a UTC string is read as Vietnam local time
 * and every job comes back seven hours early; any job shorter than seven hours
 * is then already past its `ends_at` on its very first tick, so the whole
 * amount lands at once and the row is closed — "cộng dần" silently degraded
 * into instant mode. Swapping in `createAnalyticsPool()` (`'+00:00'`) only
 * moves the mismatch to whichever pool is the odd one out; the query builder is
 * the only read that is symmetric by construction.
 *
 * `GET_LOCK` / `RELEASE_LOCK` are the deliberate exception: a named lock is
 * held by a connection rather than a pool, so they need a raw pooled connection
 * — and neither statement touches a date.
 */
import type { Pool, PoolConnection } from 'mysql2/promise'
import { and, eq, sql } from 'drizzle-orm'
import { getDb, getPool } from '../utils/db'
import { articleViewBoost } from '../db/schema'
import { addFabricatedViews } from './article-views'
import { logError, logInfo } from '../utils/logger'

const LOCK_NAME = 'cdkt:articles:view-boost'
const LOCK_TIMEOUT_SECONDS = 0

/** One minute. Finer granularity than the job's own minute-based duration buys nothing. */
export const TICK_INTERVAL_MS = 60 * 1000

export type BoostJob = {
  id: number
  articleId: number
  totalAmount: number
  appliedAmount: number
  startedAt: Date
  endsAt: Date
}

export type BoostDue = { deliver: number; done: boolean }

/**
 * Pure: how much of this job is outstanding right now?
 *
 * The target is derived from *absolute elapsed time*, not accumulated per tick.
 * That single choice makes the job self-correcting: a missed tick, several
 * bunched ticks, a paused process, or a restart hours after `ends_at` all
 * resolve to the same answer — deliver whatever is outstanding, never more than
 * authorised. A per-tick increment scheme would silently lose everything a
 * downtime window covered, and nothing would say so.
 *
 * No clock, no database, no randomness: `now` is a parameter so every edge can
 * be tested directly.
 */
export function computeBoostDue(job: BoostJob, now: Date): BoostDue {
  const total = Math.max(0, Math.floor(job.totalAmount))
  const applied = Math.min(total, Math.max(0, Math.floor(job.appliedAmount)))
  const remaining = total - applied

  const startedAt = job.startedAt.getTime()
  const endsAt = job.endsAt.getTime()
  const nowMs = now.getTime()

  // Past the window — or a zero/negative duration, which is the same instruction
  // issued instantly. Everything outstanding is due, and the job is finished.
  if (nowMs >= endsAt || endsAt <= startedAt) {
    return { deliver: remaining, done: true }
  }
  if (nowMs <= startedAt) return { deliver: 0, done: false }

  const target = Math.floor((total * (nowMs - startedAt)) / (endsAt - startedAt))
  // Clamped on both sides: `target` can never authorise more than `total`, and
  // `deliver` can never go negative if `applied` ever runs ahead of the target.
  const deliver = Math.max(0, Math.min(target, total) - applied)
  return { deliver, done: false }
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

/** Drizzle maps `datetime({ mode: 'date' })` to a Date, but a driver-level change to string mode must not silently break the schedule. */
function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value))
}

export type BoostPassResult = { jobs: number; delivered: number; completed: number }

export type RunBoostPassOptions = { now?: Date }

/**
 * One delivery pass over every running job. Returns null when the lock is held
 * elsewhere.
 *
 * Queueing behind a held lock would be worse than skipping: the next tick is 60
 * seconds away and `computeBoostDue` is time-derived, so a skipped pass costs
 * nothing — the following pass delivers the combined shortfall.
 */
export async function runBoostPass(options: RunBoostPassOptions = {}): Promise<BoostPassResult | null> {
  const now = options.now ?? new Date()
  const pool = getPool()
  if (!pool) return null
  const db = getDb()

  return withLock(pool, async () => {
    const rows = await db
      .select({
        id:            articleViewBoost.id,
        articleId:     articleViewBoost.articleId,
        totalAmount:   articleViewBoost.totalAmount,
        appliedAmount: articleViewBoost.appliedAmount,
        startedAt:     articleViewBoost.startedAt,
        endsAt:        articleViewBoost.endsAt,
      })
      .from(articleViewBoost)
      .where(eq(articleViewBoost.status, 'running'))

    const result: BoostPassResult = { jobs: 0, delivered: 0, completed: 0 }
    for (const row of rows) {
      const job: BoostJob = {
        id: Number(row.id),
        articleId: Number(row.articleId),
        totalAmount: Number(row.totalAmount),
        appliedAmount: Number(row.appliedAmount),
        startedAt: toDate(row.startedAt),
        endsAt: toDate(row.endsAt),
      }
      result.jobs += 1

      const due = computeBoostDue(job, now)
      if (due.deliver > 0) {
        // `applied_amount` is bumped by the delivered amount rather than set to
        // the computed target, and both statements are guarded on the row still
        // being `running`: a cancellation landing mid-pass stops further
        // delivery instead of having its status overwritten.
        const [updated] = await db
          .update(articleViewBoost)
          .set({ appliedAmount: sql`${articleViewBoost.appliedAmount} + ${due.deliver}` })
          .where(and(eq(articleViewBoost.id, job.id), eq(articleViewBoost.status, 'running')))
        // The counter is claimed before the views are written. The other order
        // would let a crash between the two statements replay the same delivery
        // on the next pass; this order can only lose one, which is the side to
        // fail on when the number is presented as fabricated anyway.
        if (updated.affectedRows) {
          await addFabricatedViews({ articleId: job.articleId, amount: due.deliver })
          result.delivered += due.deliver
        }
      }
      if (due.done) {
        const [closed] = await db
          .update(articleViewBoost)
          .set({ status: 'completed' })
          .where(and(eq(articleViewBoost.id, job.id), eq(articleViewBoost.status, 'running')))
        if (closed.affectedRows) result.completed += 1
      }
    }

    if (result.delivered > 0 || result.completed > 0) {
      logInfo({ event: 'article_view_boost.pass', ...result })
    }
    return result
  })
}

let timer: ReturnType<typeof setInterval> | null = null

/**
 * Start ticking. Idempotent, and `unref()`ed so the timer never holds the
 * process open — a delivery pass is not worth delaying a shutdown for, and the
 * next start recomputes the shortfall from elapsed time anyway.
 */
export function startViewBoostScheduler(): void {
  if (timer) return
  const tick = () => {
    runBoostPass().catch((error) => {
      // Swallowed on purpose: a scheduler that throws into an unhandled
      // rejection takes the worker with it, and a missed pass is not worth an
      // outage. The next tick delivers the combined shortfall.
      logError({ event: 'article_view_boost.scheduler_failed', message: error instanceof Error ? error.message : String(error) })
    })
  }
  timer = setInterval(tick, TICK_INTERVAL_MS)
  timer.unref?.()
  // First pass is deferred: at boot the database may not be reachable yet, and
  // init/seed are still running.
  const warmup = setTimeout(tick, 60_000)
  warmup.unref?.()
}

export function stopViewBoostScheduler(): void {
  if (!timer) return
  clearInterval(timer)
  timer = null
}
