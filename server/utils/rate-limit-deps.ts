/**
 * The one way a request handler gets a rate-limit executor.
 *
 * This exact three-line literal was pasted into 13 call sites:
 *
 *     const deps = { execute: pool ? ((sql, params) => pool.query(sql, params)) : null }
 *
 * Thirteen copies of a decision is thirteen places to get it wrong, and the
 * decision here is not cosmetic: `getPool()` returns null when the database is
 * unreachable, and `execute: null` is what makes `rate-limit-store` fall back to
 * its in-process memory map instead of failing open. A copy that wrote
 * `execute: getPool()!.query` — or that forgot the null branch — would turn a
 * database blip into either a crash or an unlimited endpoint, and it would look
 * correct next to the twelve that are right.
 *
 * Lives HERE rather than in `rate-limit-store.ts` on purpose. That module
 * imports nothing but the logger, which is what lets the whole limiter be
 * exercised in tests against a plain Map with no MySQL anywhere. Importing
 * `getPool` into it would drag the database layer into every one of those tests.
 */
import { getPool } from './db'
import type { RateLimitDeps } from './rate-limit-store'

/**
 * Bind the rate limiter to the connection pool, or to nothing.
 *
 * A null pool is a normal outcome, not an error: the store degrades to
 * per-process memory, which is weaker across replicas but never open. See the
 * fallback note in rate-limit-store.ts.
 */
export function rateLimitDeps(): RateLimitDeps {
  const pool = getPool()
  return {
    execute: pool ? ((sql: string, params: unknown[]) => pool.query(sql, params)) : null,
  }
}
