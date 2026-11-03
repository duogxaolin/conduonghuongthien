/**
 * Run a whole transaction again when InnoDB picks it as a deadlock victim.
 *
 * Two lock orders on the reader tables cannot both be avoided: a reply under a reader's
 * comment holds that comment, then the reader row (the notification's foreign key), while
 * a ban or an account deletion takes the reader row, then its comments — as the retention
 * purge (and the FK cascade) does. A ban next to a reply deadlocked on MySQL 8 in 27–30 of 30
 * rounds before this slice (replay: docs/test-coverage-baseline-2026-10.md, "Lát R6"), and the
 * ban came back as a 500. InnoDB rolls the victim back in full, so repeating it is safe: the
 * retry sees the reply committed and goes through.
 *
 * Only a deadlock (1213). A lock-wait timeout (1205) has already waited
 * `innodb_lock_wait_timeout`; repeating it would hold the request minutes longer. Same rule
 * as the page-view ingestion's own retry (`analytics-ingestion.ts`), which reads its deadlocks
 * through this same `isDeadlock` — the one definition in `server/` (it had its own byte-identical
 * copy until slice R7; `tests/mysql-error-predicates.test.ts` keeps it to one).
 */
import { hasMysqlError } from './mysql-errors'

/** ER_LOCK_DEADLOCK (1213), on the error or anywhere down its `cause` chain (Drizzle wraps the driver's error). */
export function isDeadlock(error: unknown): boolean {
  return hasMysqlError(error, 1213, 'ER_LOCK_DEADLOCK')
}

/** Attempts in all, the first included. */
export const DEADLOCK_ATTEMPTS = 3

export async function withDeadlockRetry<T>(
  run: () => Promise<T>,
  options: { attempts?: number, sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const attempts = options.attempts ?? DEADLOCK_ATTEMPTS
  const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)))
  for (let attempt = 1; ; attempt++) {
    try {
      return await run()
    } catch (error) {
      if (attempt >= attempts || !isDeadlock(error)) throw error
      // Jittered, so two victims of one deadlock do not meet again at once.
      await sleep(5 + Math.floor(Math.random() * 21))
    }
  }
}
