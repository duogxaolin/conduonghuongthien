import { startViewBoostScheduler } from '../services/view-boost-scheduler'

/**
 * Start the gradual view-inflation delivery loop on boot.
 *
 * Held back outside production by default, matching the retention scheduler: a
 * dev machine restarting repeatedly should not keep writing fabricated view rows
 * against seed articles. Set VIEW_BOOST_SCHEDULER=1 to exercise it locally, or
 * VIEW_BOOST_SCHEDULER=0 in production to stop delivery entirely.
 *
 * Turning it off does not cancel anything: jobs stay `running` and, because
 * delivery is derived from elapsed time rather than accumulated per tick, the
 * first pass after it comes back on delivers the whole shortfall at once.
 */
export default defineNitroPlugin(() => {
  const override = (process.env.VIEW_BOOST_SCHEDULER || '').trim().toLowerCase()
  if (['0', 'false', 'off', 'no'].includes(override)) return
  const enabled = ['1', 'true', 'on', 'yes'].includes(override) || process.env.NODE_ENV === 'production'
  if (!enabled) return

  startViewBoostScheduler()
})
