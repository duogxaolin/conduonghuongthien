import { startRetentionScheduler } from '../services/retention-scheduler'

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
 */
export default defineNitroPlugin(() => {
  const override = (process.env.RETENTION_SCHEDULER || '').trim().toLowerCase()
  if (['0', 'false', 'off', 'no'].includes(override)) return
  const enabled = ['1', 'true', 'on', 'yes'].includes(override) || process.env.NODE_ENV === 'production'
  if (!enabled) return

  startRetentionScheduler()
})
