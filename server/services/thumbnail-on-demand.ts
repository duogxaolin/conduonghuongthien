import { rm } from 'node:fs/promises'
import { logWarn } from '../utils/logger'
import { extractThumbnailOnDemand, type ProcessRunner } from './video-processing'

/**
 * Bounds on the PUBLIC on-demand thumbnail fallback (spec video-thumbnails,
 * design D19).
 *
 * `GET /api/public/media/<id>/thumb` is unauthenticated. When a published upload
 * had no thumbnail it spawned FFmpeg on every request: ten cards on a list page
 * were ten processes for one video, nothing limited how long one ran, and a
 * corrupt file was re-tried on every view. Four bounds, all in memory (a restart
 * retrying once is acceptable):
 *
 *   • single flight — concurrent requests for one video share one run, keyed by
 *     the output path (the video's own `thumb.jpg`), so a short-id URL and a
 *     legacy slug URL for the same video are one key, not two writers racing on
 *     one file;
 *   • a global semaphore of 2 — across all videos;
 *   • a time limit — `AbortSignal.timeout(15 s)` handed to the runner, which
 *     SIGKILLs FFmpeg on abort; the partial `thumb.jpg` is deleted before the
 *     result is reported, so a half-written file is never served as the static
 *     thumbnail on the next request;
 *   • negative cache — a failed or killed run is remembered 10 minutes, during
 *     which the endpoint serves the placeholder without spawning anything.
 */

export const ON_DEMAND_THUMBNAIL_TIMEOUT_MS = 15_000
export const ON_DEMAND_THUMBNAIL_MAX_CONCURRENT = 2
export const ON_DEMAND_THUMBNAIL_FAILURE_TTL_MS = 10 * 60_000
/** Above this many remembered failures, expired entries are swept on insert. */
const FAILURE_SWEEP_THRESHOLD = 500

export type OnDemandThumbnailDeps = {
  run?: ProcessRunner
  timeoutMs?: number
  maxConcurrent?: number
  failureTtlMs?: number
  now?: () => number
}

export type OnDemandThumbnailExtractor = {
  /**
   * Extract one frame of `input` into `outPath`. `true` = `outPath` now holds the
   * frame. `false` = failed, timed out, or failed recently (no process started).
   */
  extract: (key: string, input: string, outPath: string) => Promise<boolean>
}

export function createOnDemandThumbnailExtractor(deps: OnDemandThumbnailDeps = {}): OnDemandThumbnailExtractor {
  const timeoutMs = deps.timeoutMs ?? ON_DEMAND_THUMBNAIL_TIMEOUT_MS
  const maxConcurrent = deps.maxConcurrent ?? ON_DEMAND_THUMBNAIL_MAX_CONCURRENT
  const failureTtlMs = deps.failureTtlMs ?? ON_DEMAND_THUMBNAIL_FAILURE_TTL_MS
  const now = deps.now ?? Date.now

  const inFlight = new Map<string, Promise<boolean>>()
  const failedUntil = new Map<string, number>()

  // Counting semaphore. A released slot is handed straight to the next waiter,
  // so `active` never dips below the true number of running processes.
  let active = 0
  const waiters: Array<() => void> = []
  const acquire = async () => {
    if (active < maxConcurrent) {
      active += 1
      return
    }
    await new Promise<void>((resolve) => { waiters.push(resolve) })
  }
  const release = () => {
    const next = waiters.shift()
    if (next) next()
    else active -= 1
  }

  const rememberFailure = (key: string) => {
    const at = now()
    if (failedUntil.size >= FAILURE_SWEEP_THRESHOLD) {
      for (const [entry, until] of failedUntil) if (until <= at) failedUntil.delete(entry)
    }
    failedUntil.set(key, at + failureTtlMs)
  }

  const runOnce = async (key: string, input: string, outPath: string): Promise<boolean> => {
    await acquire()
    try {
      const signal = AbortSignal.timeout(timeoutMs)
      const ok = await extractThumbnailOnDemand(input, outPath, { signal, run: deps.run })
      if (ok) return true
      // Killed or failed: whatever FFmpeg wrote is not a thumbnail.
      await rm(outPath, { force: true }).catch(() => undefined)
      rememberFailure(key)
      logWarn({ event: 'public.media_thumbnail_fallback_failed', reason: signal.aborted ? 'timeout' : 'ffmpeg_failed' })
      return false
    } finally {
      release()
    }
  }

  return {
    extract(key, input, outPath) {
      const until = failedUntil.get(key)
      if (until !== undefined) {
        if (until > now()) return Promise.resolve(false)
        failedUntil.delete(key)
      }
      const running = inFlight.get(key)
      if (running) return running
      const promise = runOnce(key, input, outPath).finally(() => { inFlight.delete(key) })
      inFlight.set(key, promise)
      return promise
    },
  }
}

/** The one instance the public endpoint uses — the bounds are per process. */
export const onDemandThumbnails = createOnDemandThumbnailExtractor()
