/**
 * The database ping of `GET /api/public/health` (`health.get.ts`), moved out of the handler
 * verbatim. The handler keeps `Cache-Control: no-store`, the version, the 2 s budget
 * (`HEALTH_DB_TIMEOUT_MS`) and `reportPublicReadFailure()` (503) when this throws.
 *
 * Imports the pool and nothing else: tests/health-endpoint.test.ts fakes `h3` and the
 * database layer alone.
 */
import { getPool } from '../utils/db'

/**
 * `SELECT 1` on the shared pool, bounded by a timer, not only by the driver's query timeout:
 * mysql2's `timeout` starts once a connection is in hand, and acquiring one from a pool whose
 * server froze can take far longer. Throws when there is no pool, when the query fails, or when
 * `timeoutMs` runs out first.
 */
export async function pingDatabase(timeoutMs: number): Promise<void> {
  const pool = getPool()
  if (!pool) throw new Error('database pool unavailable')
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`database ping timed out after ${timeoutMs} ms`)),
      timeoutMs,
    )
  })
  try {
    await Promise.race([pool.query({ sql: 'SELECT 1', timeout: timeoutMs }), expired])
  } finally {
    clearTimeout(timer)
  }
}
