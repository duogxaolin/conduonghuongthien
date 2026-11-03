import { startRetentionScheduler } from '../services/retention-scheduler'
import { startRateLimitPurgeScheduler, stopRateLimitPurgeScheduler } from '../services/rate-limit-purge-scheduler'

/**
 * Start the retention purge on boot.
 *
 * Held back outside production by default: a dev machine that runs `db:seed`,
 * pokes around and restarts should not silently delete the audit rows the
 * developer is looking at. Set RETENTION_SCHEDULER=1 to exercise it locally,
 * or RETENTION_SCHEDULER=0 in production to hand the job back to cron.
 *
 * Safe to leave on alongside `npm run analytics:maintenance`: both take the same
 * MySQL named lock, so whichever arrives second finds it held and skips.
 *
 * The same switch starts a second, independent timer: the sweep of expired
 * rate-limit counters (design D16). It has its own lock and never consults the
 * admin auto-cleanup setting, so a retention scope that fails — or retention
 * turned off in the admin — cannot stop it. With the in-process timers handed to
 * cron, the cron entry point runs that sweep too. Nitro `close` stops that timer
 * (interval and warm-up) so a shutting-down worker starts no new sweep.
 */
export default defineNitroPlugin((nitroApp) => {
  const override = (process.env.RETENTION_SCHEDULER || '').trim().toLowerCase()
  if (['0', 'false', 'off', 'no'].includes(override)) return
  const enabled = ['1', 'true', 'on', 'yes'].includes(override) || process.env.NODE_ENV === 'production'
  if (!enabled) return

  startRetentionScheduler()
  startRateLimitPurgeScheduler()
  nitroApp.hooks.hook('close', () => stopRateLimitPurgeScheduler())
})
