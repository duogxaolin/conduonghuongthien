/**
 * When an auto-advancing carousel may move (spec public-accessibility, design D23).
 *
 * One rule, and the bug that taught it: **only the pause/play control changes
 * what the visitor wants.** 9cf1bb8 also let a `touchstart` on the carousel set
 * "paused" — and a tap on the pause button is a `touchstart` that bubbles to the
 * carousel root before the button's `click`, so the click toggled the wish
 * straight back to "playing": on a phone, "Tạm dừng" did nothing.
 *
 *   • Nothing moves before `init` — i.e. never during SSR.
 *   • Reduced motion (`prefers-reduced-motion: reduce`, read at mount) starts
 *     with the wish "paused"; the control then offers "play". A change of that
 *     preference while the page is open is followed too — until the visitor has
 *     pressed the control once; from then on their explicit choice stands.
 *   • Transient pauses, each lasting only while its cause lasts:
 *       hover  — a mouse/pen pointer over the carousel (touch pointers ignored:
 *                a tap emulates mouseenter and never sends the matching leave);
 *       focus  — focus anywhere inside, the control itself included, however it
 *                got there (Tab, or a click/tap that focused a button or link);
 *       touch  — a finger down on the slides (not on the control), until the
 *                LAST finger lifts;
 *       hidden — the tab is hidden;
 *       empty  — nothing to show.
 *   • Pressing "play" overrides the pauses that mean "the visitor is at the
 *     carousel" (hover, focus, touch) until the next one starts; it cannot
 *     override a hidden tab or an empty carousel.
 *
 * Pure: the component reports DOM events here and maps `running` to its
 * interval through `onChange`. `tests/carousel-motion-control.test.ts` replays
 * real event orders; `tests/e2e/carousel-pause.spec.ts` checks them in Chromium.
 */

export type AutoplayPauseReason = 'hover' | 'focus' | 'touch' | 'hidden' | 'empty'

/** Pauses that describe the visitor being at the carousel — "play" overrides them. */
const OVERRIDDEN_BY_PLAY: readonly AutoplayPauseReason[] = ['hover', 'focus', 'touch']

export type CarouselAutoplay = {
  /** Call once on the client with the reduced-motion preference. */
  init: (reducedMotion: boolean) => void
  /** The pause/play control — the only thing that changes the visitor's wish. */
  pressToggle: () => void
  /** `fromToggle`: the touch started on the pause/play control itself. */
  touchStart: (fromToggle: boolean) => void
  /** `remainingTouches`: fingers still down (`TouchEvent.touches.length`). */
  touchEnd: (remainingTouches: number) => void
  /** The system `prefers-reduced-motion` preference changed. */
  reducedMotionChange: (reducedMotion: boolean) => void
  pointerEnter: (pointerType: string) => void
  pointerLeave: (pointerType: string) => void
  focusIn: () => void
  /** `stillInside`: focus moved to another element of the carousel. */
  focusOut: (stillInside: boolean) => void
  visibilityChange: (hidden: boolean) => void
  slidesChange: (count: number) => void
  /** What the control shows: `true` = autoplay wanted (label "pause"). */
  readonly autoplayOn: boolean
  readonly running: boolean
}

export function createCarouselAutoplay(onChange: (running: boolean) => void): CarouselAutoplay {
  let ready = false
  let wanted = true
  /** The visitor pressed the control at least once: preferences no longer decide. */
  let chosen = false
  let running = false
  const reasons = new Set<AutoplayPauseReason>()

  const sync = () => {
    const next = ready && wanted && reasons.size === 0
    if (next === running) return
    running = next
    onChange(next)
  }
  const pause = (reason: AutoplayPauseReason) => {
    reasons.add(reason)
    sync()
  }
  const resume = (reason: AutoplayPauseReason) => {
    reasons.delete(reason)
    sync()
  }
  const isTouchPointer = (pointerType: string) => pointerType === 'touch'

  return {
    init(reducedMotion) {
      ready = true
      wanted = !reducedMotion
      sync()
    },
    pressToggle() {
      chosen = true
      wanted = !wanted
      if (wanted) for (const reason of OVERRIDDEN_BY_PLAY) reasons.delete(reason)
      sync()
    },
    touchStart(fromToggle) {
      if (!fromToggle) pause('touch')
    },
    touchEnd(remainingTouches) {
      if (remainingTouches === 0) resume('touch')
    },
    reducedMotionChange(reducedMotion) {
      if (chosen) return
      wanted = !reducedMotion
      sync()
    },
    pointerEnter(pointerType) {
      if (!isTouchPointer(pointerType)) pause('hover')
    },
    pointerLeave(pointerType) {
      if (!isTouchPointer(pointerType)) resume('hover')
    },
    focusIn() {
      pause('focus')
    },
    focusOut(stillInside) {
      if (!stillInside) resume('focus')
    },
    visibilityChange(hidden) {
      if (hidden) pause('hidden')
      else resume('hidden')
    },
    slidesChange(count) {
      if (count > 0) resume('empty')
      else pause('empty')
    },
    get autoplayOn() { return wanted },
    get running() { return running },
  }
}
