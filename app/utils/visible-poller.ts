/**
 * Poll only while it matters (spec live-status-polling, design D20).
 *
 * `LiveTickerBar` (in the layout, on every public page) and `LiveHero` (/media)
 * asked `/api/public/livestream/active` every 8 s from tabs nobody was looking
 * at, and the ticker did so on /media where it never shows. This controller:
 *   • runs `poll` once at start, then every `intervalMs`, only while enabled AND
 *     the document is visible;
 *   • stops the interval when the tab is hidden, and polls once immediately when
 *     it becomes visible again (the state may have changed meanwhile);
 *   • `setEnabled(false)` stops it where the consumer cannot show anything;
 *     `setEnabled(true)` polls at once.
 *
 * Kept free of `document`/`window` so it is testable without a browser: the
 * environment is injected, `browserPollerEnv()` is the real one. Construct it in
 * `onMounted` — never during SSR, where nothing would ever clear the interval.
 */

export type VisiblePollerEnv = {
  isHidden: () => boolean
  /** Subscribe to visibility changes; returns the unsubscribe function. */
  onVisibilityChange: (callback: () => void) => () => void
  setInterval: (fn: () => void, ms: number) => unknown
  clearInterval: (handle: unknown) => void
}

export type VisiblePoller = {
  start: (enabled?: boolean) => void
  setEnabled: (enabled: boolean) => void
  stop: () => void
}

export function createVisiblePoller(poll: () => void, intervalMs: number, env: VisiblePollerEnv): VisiblePoller {
  let handle: unknown = null
  let enabled = false
  let started = false
  let unsubscribe: (() => void) | null = null

  const disarm = () => {
    if (handle === null) return
    env.clearInterval(handle)
    handle = null
  }
  /** Bring the interval in line with the state; poll now when it (re)starts. */
  const sync = () => {
    if (!started || !enabled || env.isHidden()) {
      disarm()
      return
    }
    if (handle !== null) return
    poll()
    handle = env.setInterval(poll, intervalMs)
  }

  return {
    start(initiallyEnabled = true) {
      if (started) return
      started = true
      enabled = initiallyEnabled
      unsubscribe = env.onVisibilityChange(sync)
      sync()
    },
    setEnabled(next) {
      if (next === enabled) return
      enabled = next
      sync()
    },
    stop() {
      started = false
      disarm()
      unsubscribe?.()
      unsubscribe = null
    },
  }
}

export function browserPollerEnv(): VisiblePollerEnv {
  return {
    isHidden: () => document.visibilityState === 'hidden',
    onVisibilityChange: (callback) => {
      document.addEventListener('visibilitychange', callback)
      return () => document.removeEventListener('visibilitychange', callback)
    },
    setInterval: (fn, ms) => window.setInterval(fn, ms),
    clearInterval: (handle) => window.clearInterval(handle as number),
  }
}
