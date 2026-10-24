import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createCarouselAutoplay } from '../app/utils/carousel-autoplay'
import { hardcodedDictionary } from '../app/composables/i18n-default-dictionary'
import { DEFAULT_TRANSLATIONS_SEED } from '../server/data/default-translations-seed'
import { renderSfcTemplate } from './_render-sfc-template'

/**
 * Motion the visitor controls (spec public-accessibility, design D23).
 *
 * The role-models carousel on the home page advanced every 3.5 s with no way to
 * stop it (WCAG 2.2.2), kept moving while a keyboard user was inside it or a
 * finger was on it, ran in background tabs, and scrolled smoothly even for
 * visitors who asked their system for reduced motion. The live ticker's marquee
 * scrolled for them too.
 */

// ─── The autoplay policy, driven event by event ──────────────────────────────
//
// Rule: ONLY the pause/play control changes what the visitor wants. Touch, focus,
// pointer-over and a hidden tab are transient pauses; pressing play overrides
// the ones that mean "the visitor is at the carousel" (touch, focus, hover).

function carouselFor(reducedMotion: boolean) {
  const changes: boolean[] = []
  const c = createCarouselAutoplay((running) => { changes.push(running) })
  c.init(reducedMotion)
  return { c, changes }
}

test('reduced motion: the carousel never advances on its own', () => {
  const { c, changes } = carouselFor(true)
  c.pointerEnter('mouse'); c.pointerLeave('mouse')
  c.focusIn(); c.focusOut(false)
  assert.equal(c.running, false)
  assert.deepEqual(changes, [])
  assert.equal(c.autoplayOn, false, 'the control must offer "play", not "pause"')
  // An explicit press is the visitor's own choice.
  c.pressToggle()
  assert.equal(c.running, true)
})

test('nothing runs before mount (server render)', () => {
  const changes: boolean[] = []
  const c = createCarouselAutoplay((running) => { changes.push(running) })
  c.pointerLeave('mouse')
  c.focusOut(false)
  assert.equal(c.running, false)
  assert.deepEqual(changes, [])
})

test('touch screen: a tap on the pause control pauses (touchstart on it is not a touch on the carousel)', () => {
  // What a tap on the button delivers, in order: touchstart (bubbling to the
  // carousel root), touchend, focus, click. 9cf1bb8 let the touchstart set
  // "paused" and the click toggle it straight back to "playing".
  const { c } = carouselFor(false)
  c.touchStart(true); c.touchEnd(); c.focusIn(); c.pressToggle()
  assert.equal(c.autoplayOn, false, 'the control still offers "pause" after tapping pause')
  assert.equal(c.running, false, 'the carousel kept moving after the visitor tapped pause')
  // Tapping elsewhere afterwards (focus leaves) must not restart it.
  c.focusOut(false)
  assert.equal(c.running, false)
  // Tap play: same event order, resumes.
  c.touchStart(true); c.touchEnd(); c.focusIn(); c.pressToggle()
  assert.equal(c.autoplayOn, true)
  assert.equal(c.running, true)
})

test('a touch on the slides pauses only while the finger is down and never changes the control', () => {
  const { c } = carouselFor(false)
  c.touchStart(false)
  assert.equal(c.running, false)
  assert.equal(c.autoplayOn, true, 'a touch is not the visitor pressing pause')
  c.touchEnd()
  assert.equal(c.running, true)
  // Emulated pointer events of a touch do not count as hover.
  c.pointerEnter('touch')
  assert.equal(c.running, true)
})

test('keyboard focus anywhere inside pauses, the control itself included', () => {
  const { c } = carouselFor(false)
  c.focusIn() // on the pause/play button
  assert.equal(c.running, false, 'focus on the control resumed the carousel')
  c.focusOut(true) // moved to a dot: still inside
  assert.equal(c.running, false)
  c.focusOut(false) // left the carousel
  assert.equal(c.running, true)
})

test('only pressing play resumes; it wins over focus and pointer-over until the next one', () => {
  const { c } = carouselFor(false)
  c.pointerEnter('mouse'); c.focusIn(); c.pressToggle() // click pause
  assert.equal(c.running, false)
  c.pointerLeave('mouse'); c.focusOut(false)
  assert.equal(c.running, false, 'leaving restarted what the visitor paused')

  c.pointerEnter('mouse'); c.focusIn(); c.pressToggle() // click play, pointer still over it
  assert.equal(c.running, true, 'play pressed while hovering did not resume')
  c.pointerLeave('mouse')
  assert.equal(c.running, true)
  c.pointerEnter('mouse') // the next hover-enter pauses again
  assert.equal(c.running, false)
})

test('play does not override a hidden tab or an empty carousel', () => {
  const { c } = carouselFor(true)
  c.visibilityChange(true)
  c.pressToggle()
  assert.equal(c.autoplayOn, true)
  assert.equal(c.running, false)
  c.visibilityChange(false)
  assert.equal(c.running, true)
  c.slidesChange(0)
  assert.equal(c.running, false)
  c.slidesChange(5)
  assert.equal(c.running, true)
})

// ─── The component wires it ──────────────────────────────────────────────────

const CAROUSEL = new URL('../app/components/blocks/RoleModelsBlock.vue', import.meta.url).pathname
const carousel = readFileSync(CAROUSEL, 'utf8')

test('RoleModelsBlock reads reduced motion, listens for focus, touch and visibility', () => {
  assert.match(carousel, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/)
  assert.match(carousel, /createCarouselAutoplay\(/)
  assert.match(carousel, /@focusin="onFocusIn"/)
  assert.match(carousel, /@focusout="onFocusOut"/)
  assert.match(carousel, /@touchstart\.passive="onTouchStart"/)
  assert.match(carousel, /@touchend\.passive="onTouchEnd"/)
  assert.match(carousel, /@touchcancel\.passive="onTouchEnd"/)
  // Pointer events, not mouseenter: a tap emulates mouseenter and never leaves.
  assert.match(carousel, /@pointerenter="onPointerEnter"/)
  assert.match(carousel, /@pointerleave="onPointerLeave"/)
  assert.doesNotMatch(carousel, /@mouseenter|@mouseleave/)
  // A touch that starts on the pause/play control is that control's, not the carousel's.
  const touchStart = carousel.slice(carousel.indexOf('const onTouchStart'), carousel.indexOf('const onTouchStart') + 300)
  assert.match(touchStart, /fromToggle\(event\)/)
  assert.match(carousel, /const fromToggle = \(event: Event\) => [^\n]*autoplayToggle\.value\?\.contains\(/)
  assert.match(carousel, /'visibilitychange'/)
  // Scrolling follows the preference too, in CSS and in script.
  assert.match(carousel, /motion-reduce:scroll-auto/)
  assert.doesNotMatch(carousel, /behavior: 'smooth'/, 'a hard-coded smooth scroll ignores reduced motion')
})

test('the arrow and dot buttons show a focus ring', () => {
  const template = carousel.slice(carousel.indexOf('<template>'), carousel.indexOf('</template>\n\n<script'))
  const buttons = [...template.matchAll(/<button[\s\S]*?>/g)].map(match => match[0])
  assert.ok(buttons.length >= 6, 'expected pause/play, two arrow pairs and the dots')
  for (const button of buttons) {
    assert.match(button, /focus-visible:ring-2/, `button without a focus ring: ${button.slice(0, 120)}`)
    assert.match(button, /focus-visible:ring-\[#4A6741\]/)
  }
})

test('the pause/play control renders with a label that says what it does', async () => {
  const t = (key: string) => hardcodedDictionary.vi![key] ?? key
  const state = {
    d: { title: 'Tấm gương' },
    list: [{ id: 'a', name: 'A', location: '', image: '/a.jpg' }, { id: 'b', name: 'B', location: '', image: '/b.jpg' }],
    loadError: false,
    pending: false,
    currentIndex: 0,
    totalCards: 2,
    t,
    autoplayOn: true,
    toggleAutoplay: () => {},
    onFocusIn: () => {},
    onFocusOut: () => {},
    onTouchStart: () => {},
    onTouchEnd: () => {},
    onPointerEnter: () => {},
    onPointerLeave: () => {},
    onScroll: () => {},
    prevSlide: () => {},
    nextSlide: () => {},
    goToSlide: () => {},
    refresh: () => {},
  }
  const playing = await renderSfcTemplate(CAROUSEL, state)
  assert.match(playing, /<button[^>]*aria-label="Tạm dừng tự chuyển slide"/)
  const paused = await renderSfcTemplate(CAROUSEL, { ...state, autoplayOn: false })
  assert.match(paused, /<button[^>]*aria-label="Tiếp tục tự chuyển slide"/)
})

test('the new labels exist in the seed and the fallback dictionary, vi and en', () => {
  for (const key of ['carousel_pause', 'carousel_play']) {
    const row = DEFAULT_TRANSLATIONS_SEED.find(entry => entry.key === key)
    assert.ok(row, `${key} missing from default-translations-seed.ts`)
    assert.ok(row.values.vi && row.values.en, `${key}: seed needs vi and en`)
    assert.equal(hardcodedDictionary.vi![key], row.values.vi)
    assert.equal(hardcodedDictionary.en![key], row.values.en)
  }
})

test('the live ticker marquee stops under reduced motion', () => {
  const ticker = readFileSync(new URL('../app/components/LiveTickerBar.vue', import.meta.url), 'utf8')
  const marquee = /class="([^"]*animate-\[ticker[^"]*)"/.exec(ticker)
  assert.ok(marquee, 'marquee element not found')
  assert.match(marquee[1]!, /motion-reduce:animate-none/)
})
