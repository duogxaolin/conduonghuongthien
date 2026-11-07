import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import test from 'node:test'

/**
 * The home hero image is the LCP element. On phones it was the 155 KB 1376 px WebP (Lighthouse on
 * production, 2026-11-07: mobile LCP 8.2 s). A 768 px variant (~37 KB) is served below 768 px.
 * The `<picture><source media>` and the `<link rel=preload>` must carry the SAME media split —
 * a preload without `media` makes a phone fetch both files, which costs more than it saves.
 */

const source = readFileSync('app/components/blocks/HeroBlock.vue', 'utf8')
const SMALL = '/assets/hero_banner-768.webp'
const LARGE = '/assets/hero_banner.webp'

test('the phone variant exists, is much smaller than the desktop one, and is a WebP', () => {
  const small = statSync(`public${SMALL}`).size
  const large = statSync(`public${LARGE}`).size
  assert.ok(small < large / 2, `phone variant ${small} B vs desktop ${large} B`)
  assert.equal(readFileSync(`public${SMALL}`).subarray(8, 12).toString('ascii'), 'WEBP')
})

test('the <picture> serves the phone variant only below 768 px, the desktop one otherwise', () => {
  assert.match(source, /<source media="\(max-width: 767px\)" srcset="\/assets\/hero_banner-768\.webp" type="image\/webp" \/>/)
  assert.match(source, /<source srcset="\/assets\/hero_banner\.webp" type="image\/webp" \/>/)
  assert.ok(source.indexOf('(max-width: 767px)" srcset') < source.indexOf('<source srcset="/assets/hero_banner.webp"'),
    'the media-qualified source comes first — the first matching source wins')
})

test('each preload carries the media of the source it matches, so a phone never fetches both', () => {
  const links = [...source.matchAll(/\{ rel: 'preload', as: 'image', href: '([^']+)', media: '([^']+)', fetchpriority: 'high' \}/g)]
    .map(match => [match[1], match[2]])
  assert.deepEqual(links, [[SMALL, '(max-width: 767px)'], [LARGE, '(min-width: 768px)']])
  assert.doesNotMatch(source, /rel: 'preload', as: 'image', href: '[^']+', fetchpriority/, 'no preload without a media condition')
})
