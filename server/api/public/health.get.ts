/**
 * GET /api/public/health — "is this build up, and can it reach its database?"
 *
 * Read by the post-deploy smoke step of CI (through the public URL, so through
 * nginx and any CDN) and by an external uptime monitor. Two answers:
 *  - 200 `{ ok: true, version }` when a `SELECT 1` on the shared pool returns
 *    within 2 s. `version` is the short commit SHA baked into the image
 *    (`APP_VERSION`, Dockerfile); a local build without it reports `dev`. The smoke
 *    step compares it with the commit it just deployed — a 200 from the OLD
 *    container (or from a cache) must not read as success.
 *  - 503 `{ ok: false, version }` otherwise, logged as `public.health_failed`.
 *
 * Bounded by a timer, not only by the driver's query timeout: mysql2's `timeout`
 * starts once a connection is in hand, and acquiring one from a pool whose server
 * froze can take far longer. Never cached: `Cache-Control: no-store` on every
 * answer, and `/api/**` is `cache: false` in nuxt.config routeRules.
 *
 * The SHA is public anyway (the repository is public); if that changes, drop
 * `version` from the body and compare it from the VPS side.
 */
import { defineEventHandler, setResponseHeader } from 'h3'
import { getPool } from '../../utils/db'
import { reportPublicReadFailure } from '../../utils/public-read-failure'

export const HEALTH_DB_TIMEOUT_MS = 2000

async function pingDatabase(timeoutMs: number): Promise<void> {
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

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'cache-control', 'no-store')
  const version = process.env.APP_VERSION || 'dev'
  try {
    await pingDatabase(HEALTH_DB_TIMEOUT_MS)
    return { ok: true, version }
  } catch (error) {
    reportPublicReadFailure(event, 'public.health_failed', error)
    return { ok: false, version }
  }
})
