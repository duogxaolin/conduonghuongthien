import { startMediaProcessingReaper, stopMediaProcessingReaper } from '../services/media-processing-reaper'

/**
 * Start the durable queue and expired-lease reaper on boot.
 *
 * Held back outside production by default, same as the retention and analytics
 * schedulers. Set MEDIA_REAPER_SCHEDULER=1 to exercise it locally, or
 * MEDIA_REAPER_SCHEDULER=0 in production to turn it off.
 *
 * Disabling it disables automatic queue pickup and stale-job recovery.
 *
 * Safe to run on more than one replica: the pass takes the same MySQL named lock
 * `cdkt:media:transcode` as the pipeline start, so an overlapping tick or a second
 * replica finds it held and does no work.
 */
export default defineNitroPlugin((nitroApp) => {
  const override = (process.env.MEDIA_REAPER_SCHEDULER || '').trim().toLowerCase()
  if (['0', 'false', 'off', 'no'].includes(override)) return
  const enabled = ['1', 'true', 'on', 'yes'].includes(override) || process.env.NODE_ENV === 'production'
  if (!enabled) return

  startMediaProcessingReaper()
  nitroApp.hooks.hook('close', stopMediaProcessingReaper)
})
