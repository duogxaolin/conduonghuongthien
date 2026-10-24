import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createAutoplayGate } from '../app/utils/carousel-autoplay'
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

// ─── The autoplay policy ─────────────────────────────────────────────────────

function gate(reducedMotion: boolean) {
  const changes: boolean[] = []
  const g = createAutoplayGate((running) => { changes.push(running) })
  g.init(reducedMotion)
  return { g, changes }
}

test('reduced motion: the carousel never advances on its own', () => {
  const { g, changes } = gate(true)
  g.resume('hover')
  g.resume('focus')
  assert.equal(g.running, false)
  assert.deepEqual(changes, [])
  assert.equal(g.autoplayOn, false, 'the control must offer "play", not "pause"')
  // An explicit press is the visitor's own choice.
  g.toggle()
  assert.equal(g.running, true)
})

test('nothing runs before mount (server render)', () => {
  const changes: boolean[] = []
  const g = createAutoplayGate((running) => { changes.push(running) })
  g.resume('hover')
  assert.equal(g.running, false)
  assert.deepEqual(changes, [])
})

test('the pause control stops it until play is pressed', () => {
  const { g } = gate(false)
  assert.equal(g.running, true)
  g.toggle()
  assert.equal(g.running, false)
  assert.equal(g.autoplayOn, false)
  // Leaving the carousel (hover, focus) must not restart what the user paused.
  g.pause('focus'); g.resume('focus')
  g.pause('hover'); g.resume('hover')
  assert.equal(g.running, false)
  g.toggle()
  assert.equal(g.running, true)
})

test('focus inside pauses; leaving resumes only if the user had not paused', () => {
  const { g } = gate(false)
  g.pause('focus')
  assert.equal(g.running, false)
  g.resume('focus')
  assert.equal(g.running, true)
})

test('a touch hands control to the visitor: paused, and the control offers play', () => {
  const { g } = gate(false)
  g.takeControl()
  assert.equal(g.running, false)
  assert.equal(g.autoplayOn, false, 'one press of the control must be enough to resume')
  g.pause('hidden'); g.resume('hidden')
  assert.equal(g.running, false, 'touch interaction must keep it paused')
  g.toggle()
  assert.equal(g.running, true)
})

test('a hidden tab pauses until shown again', () => {
  const { g } = gate(false)
  g.pause('hidden')
  assert.equal(g.running, false)
  g.resume('hidden')
  assert.equal(g.running, true)
})

// ─── The component wires it ──────────────────────────────────────────────────

const CAROUSEL = new URL('../app/components/blocks/RoleModelsBlock.vue', import.meta.url).pathname
const carousel = readFileSync(CAROUSEL, 'utf8')

test('RoleModelsBlock reads reduced motion, listens for focus, touch and visibility', () => {
  assert.match(carousel, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/)
  assert.match(carousel, /createAutoplayGate\(/)
  assert.match(carousel, /@focusin="onFocusIn"/)
  assert.match(carousel, /@focusout="onFocusOut"/)
  assert.match(carousel, /@touchstart\.passive="/)
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
