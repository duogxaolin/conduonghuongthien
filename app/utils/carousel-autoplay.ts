/**
 * When an auto-advancing carousel may move (spec public-accessibility, design D23).
 *
 *   • Nothing moves before `init` — i.e. never during SSR.
 *   • Reduced motion (`prefers-reduced-motion: reduce`, read at mount) starts it
 *     paused; the visible control then offers "play", and pressing it is the
 *     visitor's own choice.
 *   • The visible pause/play control (`toggle`) is the visitor's decision and
 *     only the control reverses it. A touch on the carousel is the same decision
 *     (`takeControl`): the visitor is handling it now.
 *   • Transient reasons pause it while they last — pointer over it, keyboard
 *     focus inside it, tab hidden, nothing to show — and leaving resumes it only
 *     if the visitor has not paused it.
 *
 * Pure: the component maps `running` to its interval through `onChange`.
 */

export type AutoplayPauseReason = 'hover' | 'focus' | 'hidden' | 'empty'

export type AutoplayGate = {
  /** Call once on the client with the reduced-motion preference. */
  init: (reducedMotion: boolean) => void
  /** The pause/play control. */
  toggle: () => void
  /** The visitor took over (touch): paused until they press play. */
  takeControl: () => void
  pause: (reason: AutoplayPauseReason) => void
  resume: (reason: AutoplayPauseReason) => void
  /** What the control shows: `true` = autoplay wanted (label "pause"). */
  readonly autoplayOn: boolean
  readonly running: boolean
}

export function createAutoplayGate(onChange: (running: boolean) => void): AutoplayGate {
  let ready = false
  let wanted = true
  let running = false
  const reasons = new Set<AutoplayPauseReason>()

  const sync = () => {
    const next = ready && wanted && reasons.size === 0
    if (next === running) return
    running = next
    onChange(next)
  }

  return {
    init(reducedMotion) {
      ready = true
      wanted = !reducedMotion
      sync()
    },
    toggle() {
      wanted = !wanted
      sync()
    },
    takeControl() {
      wanted = false
      sync()
    },
    pause(reason) {
      reasons.add(reason)
      sync()
    },
    resume(reason) {
      reasons.delete(reason)
      sync()
    },
    get autoplayOn() { return wanted },
    get running() { return running },
  }
}
