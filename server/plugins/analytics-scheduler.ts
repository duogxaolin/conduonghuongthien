import { startAnalyticsScheduler } from '../services/analytics-scheduler'

/**
 * Start analytics aggregation and purge on boot.
 *
 * Held back outside production by default, same as the retention scheduler: a dev
 * machine that seeds data, pokes around and restarts should not fold today's rows
 * into the daily tables and delete the raw events the developer is looking at. Set
 * ANALYTICS_SCHEDULER=1 to exercise it locally, or ANALYTICS_SCHEDULER=0 in
 * production to hand the job back to cron.
 *
 * Safe to leave on alongside `npm run analytics:maintenance`: the pass takes the
 * MySQL named lock `cdkt:analytics:maintenance`, so whichever arrives second finds
 * it held and reports `locked` without touching a row.
 *
 * Turning this off without installing the crontab line means raw events are never
 * purged — the table grows until the disk fills. That is the whole reason the
 * scheduler exists, so ANALYTICS_SCHEDULER=0 is a choice to run cron, not a choice
 * to skip the work.
 */
export default defineNitroPlugin(() => {
  const override = (process.env.ANALYTICS_SCHEDULER || '').trim().toLowerCase()
  if (['0', 'false', 'off', 'no'].includes(override)) return
  const enabled = ['1', 'true', 'on', 'yes'].includes(override) || process.env.NODE_ENV === 'production'
  if (!enabled) return

  startAnalyticsScheduler()
})
