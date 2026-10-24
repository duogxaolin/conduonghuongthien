import { getPool } from '../utils/db'
import { withNamedLock } from '../utils/named-lock'
import { logError, logInfo, logWarn } from '../utils/logger'
import { purgeExpiredRateLimits, type RateLimitPurgeResult } from '../utils/rate-limit-store'

/**
 * Sweep of expired `rate_limit_counters` rows, on a timer of its own (design D16).
 *
 * It used to be the last statement of the retention purge, which had two ways to
 * never run it: a scope that threw first returned 'failed' before reaching it,
 * and with auto-cleanup switched off in the admin the whole pass declined. The
 * counters are not personal data under a retention policy — they are a cache of
 * lapsed windows — so nothing about that switch applies to them. This pass never
 * reads the retention policy.
 *
 * Runs on the SHARED pool (`getPool()`, `timezone: '+07:00'`), the same pool the
 * request handlers write the counters through (`rateLimitDeps()`), so the
 * `window_expires_at <= ?` comparison uses the writer's encoding of time. The
 * old sweep ran on the analytics pool (`+00:00`) and so lagged expiry by 7 hours —
 * never unsafe, but late.
 *
 * Its own named lock, timeout 0: two replicas (or the cron entry point) cannot
 * sweep at once, and a long retention pass holding `cdkt:data:retention` cannot
 * make this one skip.
 */

export const RATE_LIMIT_PURGE_LOCK = 'cdkt:ratelimit:purge'
const LOCK_TIMEOUT_SECONDS = 0

/** Every 10 minutes: at most 50 000 rows per run (`RATE_LIMIT_PURGE_MAX_BATCHES`). */
export const RATE_LIMIT_PURGE_TICK_MS = 10 * 60 * 1000
/** First pass after boot — init/seed may still be running, as for retention. */
const WARMUP_MS = 90_000

type LockPool = Parameters<typeof withNamedLock>[0]

export type RateLimitPurgeOutcome =
  | { ran: false; reason: 'no-database' | 'locked' }
  | { ran: true; result: RateLimitPurgeResult }

export type RateLimitPurgeOptions = {
  /** Test seam. `null` means "no database" and is honoured, not replaced. */
  pool?: LockPool | null
  now?: () => number
}

export async function runRateLimitPurgePass(options: RateLimitPurgeOptions = {}): Promise<RateLimitPurgeOutcome> {
  const pool = options.pool !== undefined ? options.pool : getPool()
  if (!pool) {
    // Still trim the in-process fallback map: it is what the limiter uses while
    // the database is unreachable.
    await purgeExpiredRateLimits({ now: options.now })
    return { ran: false, reason: 'no-database' }
  }

  const outcome = await withNamedLock(pool, RATE_LIMIT_PURGE_LOCK, LOCK_TIMEOUT_SECONDS, connection =>
    purgeExpiredRateLimits({
      now: options.now,
      execute: (sql, params) => connection.query(sql, params),
    }))
  if (!outcome.acquired) return { ran: false, reason: 'locked' }

  const result = outcome.value
  if (result.bounded) {
    logWarn({ event: 'rate_limit.purge_backlog', deleted: result.deleted, batches: result.batches, consequence: 'rows remain; the next tick continues' })
  } else if (result.deleted > 0) {
    logInfo({ event: 'rate_limit.purge', deleted: result.deleted, batches: result.batches })
  }
  return { ran: true, result }
}

let timer: ReturnType<typeof setInterval> | null = null

/** Idempotent; both timers are `unref()`ed so a sweep never delays shutdown. */
export function startRateLimitPurgeScheduler(): void {
  if (timer) return
  const tick = () => {
    runRateLimitPurgePass().catch((error) => {
      // A rejected timer callback is an unhandled rejection in the worker. The
      // next tick tries again.
      logError({ event: 'rate_limit.purge_failed', message: error instanceof Error ? error.message : String(error) })
    })
  }
  timer = setInterval(tick, RATE_LIMIT_PURGE_TICK_MS)
  timer.unref?.()
  const warmup = setTimeout(tick, WARMUP_MS)
  warmup.unref?.()
}

export function stopRateLimitPurgeScheduler(): void {
  if (!timer) return
  clearInterval(timer)
  timer = null
}
