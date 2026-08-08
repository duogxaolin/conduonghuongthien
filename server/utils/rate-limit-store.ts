/**
 * Rate limiting that survives a restart and holds across replicas.
 *
 * The login and public-form limiters were plain `Map`s in the worker process.
 * That means a container restart clears every lockout — an attacker who can
 * make the app restart, or who simply waits for a deploy, gets a fresh five
 * attempts — and with two replicas behind a proxy the effective limit doubles.
 *
 * Counters now live in a MySQL table. When the database cannot be reached the
 * limiter falls back to the previous in-process behaviour rather than failing
 * open or locking everyone out: for the login path the database is needed to
 * check the password anyway, so a fallback is never the difference between
 * protected and unprotected.
 */

import { affectedRowsOrZero } from './affected-rows'
import { logWarn } from './logger'

export type RateLimitRule = { limit: number; windowSeconds: number }

export type RateLimitState = {
  /** Attempts recorded inside the current window. */
  count: number
  blocked: boolean
  /** Seconds until the window resets. 0 when not blocked. */
  retryAfterSeconds: number
  backend: 'database' | 'memory'
}

/** A minimal executor so tests can drive this without a MySQL server. */
export type RateLimitExecutor = (sql: string, params: unknown[]) => Promise<unknown>

export type RateLimitDeps = {
  execute?: RateLimitExecutor | null
  now?: () => number
  memory?: Map<string, { count: number; expiresAt: number }>
}

export const RATE_LIMIT_TABLE = 'rate_limit_counters'

const fallbackMemory = new Map<string, { count: number; expiresAt: number }>()
const MEMORY_MAX_KEYS = 20_000

function memoryStore(deps: RateLimitDeps) {
  return deps.memory ?? fallbackMemory
}

function readMemory(deps: RateLimitDeps, key: string, rule: RateLimitRule, now: number): RateLimitState {
  const entry = memoryStore(deps).get(key)
  if (!entry || entry.expiresAt <= now) return { count: 0, blocked: false, retryAfterSeconds: 0, backend: 'memory' }
  const blocked = entry.count >= rule.limit
  return {
    count: entry.count,
    blocked,
    retryAfterSeconds: blocked ? Math.max(1, Math.ceil((entry.expiresAt - now) / 1000)) : 0,
    backend: 'memory',
  }
}

function bumpMemory(deps: RateLimitDeps, key: string, rule: RateLimitRule, now: number): RateLimitState {
  const store = memoryStore(deps)
  const entry = store.get(key)
  const expired = !entry || entry.expiresAt <= now
  const next = {
    count: expired ? 1 : entry!.count + 1,
    expiresAt: expired ? now + rule.windowSeconds * 1000 : entry!.expiresAt,
  }
  store.set(key, next)
  // Bound growth. Insertion order makes the first key the oldest inserted.
  if (store.size > MEMORY_MAX_KEYS) {
    const oldest = store.keys().next().value
    if (oldest !== undefined) store.delete(oldest)
  }
  const blocked = next.count >= rule.limit
  return {
    count: next.count,
    blocked,
    retryAfterSeconds: blocked ? Math.max(1, Math.ceil((next.expiresAt - now) / 1000)) : 0,
    backend: 'memory',
  }
}

function firstRow(result: unknown): Record<string, unknown> | null {
  // mysql2 returns [rows, fields]; rows is an array for SELECT.
  const rows = Array.isArray(result) ? result[0] : result
  if (Array.isArray(rows) && rows.length > 0 && typeof rows[0] === 'object') {
    return rows[0] as Record<string, unknown>
  }
  return null
}

function stateFromRow(row: Record<string, unknown> | null, rule: RateLimitRule, now: number): RateLimitState {
  if (!row) return { count: 0, blocked: false, retryAfterSeconds: 0, backend: 'database' }
  const count = Number(row.hit_count ?? 0)
  const expiresAt = new Date(String(row.window_expires_at ?? 0)).getTime()
  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    return { count: 0, blocked: false, retryAfterSeconds: 0, backend: 'database' }
  }
  const blocked = count >= rule.limit
  return {
    count,
    blocked,
    retryAfterSeconds: blocked ? Math.max(1, Math.ceil((expiresAt - now) / 1000)) : 0,
    backend: 'database',
  }
}

/** Read the current state without recording an attempt. */
export async function peekRateLimit(key: string, rule: RateLimitRule, deps: RateLimitDeps = {}): Promise<RateLimitState> {
  const now = deps.now?.() ?? Date.now()
  if (!deps.execute) return readMemory(deps, key, rule, now)
  try {
    const result = await deps.execute(
      `SELECT hit_count, window_expires_at FROM ${RATE_LIMIT_TABLE} WHERE bucket_key = ? LIMIT 1`,
      [key],
    )
    return stateFromRow(firstRow(result), rule, now)
  } catch (error) {
    logWarn({
      event: 'rate_limit.database_read_failed',
      error,
      consequence: 'falling back to in-process counter for this request',
    })
    return readMemory(deps, key, rule, now)
  }
}

/** Record one attempt against the bucket and return the resulting state. */
export async function recordRateLimitHit(key: string, rule: RateLimitRule, deps: RateLimitDeps = {}): Promise<RateLimitState> {
  const now = deps.now?.() ?? Date.now()
  if (!deps.execute) return bumpMemory(deps, key, rule, now)

  const nowDate = new Date(now)
  const expiresAt = new Date(now + rule.windowSeconds * 1000)
  try {
    // A single statement so two concurrent attempts cannot both read "1".
    // `window_expires_at <= now` means the previous window lapsed: restart at 1
    // rather than resurrecting a stale count.
    await deps.execute(
      `INSERT INTO ${RATE_LIMIT_TABLE} (bucket_key, hit_count, window_expires_at)
       VALUES (?, 1, ?)
       ON DUPLICATE KEY UPDATE
         hit_count = IF(window_expires_at <= ?, 1, hit_count + 1),
         window_expires_at = IF(window_expires_at <= ?, ?, window_expires_at)`,
      [key, expiresAt, nowDate, nowDate, expiresAt],
    )
    const result = await deps.execute(
      `SELECT hit_count, window_expires_at FROM ${RATE_LIMIT_TABLE} WHERE bucket_key = ? LIMIT 1`,
      [key],
    )
    return stateFromRow(firstRow(result), rule, now)
  } catch (error) {
    logWarn({
      event: 'rate_limit.database_write_failed',
      error,
      consequence: 'falling back to in-process counter for this request',
    })
    return bumpMemory(deps, key, rule, now)
  }
}

/** Drop a bucket — called after a successful login so one typo does not linger. */
export async function clearRateLimit(key: string, deps: RateLimitDeps = {}): Promise<void> {
  memoryStore(deps).delete(key)
  if (!deps.execute) return
  try {
    await deps.execute(`DELETE FROM ${RATE_LIMIT_TABLE} WHERE bucket_key = ?`, [key])
  } catch {
    /* the memory copy is already gone; a stale DB row expires on its own */
  }
}

/** Remove lapsed buckets. Called by the nightly maintenance job. */
export async function purgeExpiredRateLimits(deps: RateLimitDeps = {}): Promise<number> {
  const now = deps.now?.() ?? Date.now()
  for (const [key, entry] of memoryStore(deps)) {
    if (entry.expiresAt <= now) memoryStore(deps).delete(key)
  }
  if (!deps.execute) return 0
  const result = await deps.execute(
    `DELETE FROM ${RATE_LIMIT_TABLE} WHERE window_expires_at <= ? LIMIT 5000`,
    [new Date(now)],
  )
  return affectedRowsOrZero(result)
}
