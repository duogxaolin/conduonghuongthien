import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

/**
 * Preloading all three FontAwesome woff2 files (solid 272 KB + regular 350 KB + brands 115 KB, high
 * priority) made them compete with the hero image: home mobile LCP 8.1 s on production (Lighthouse,
 * 2026-11-07); without the regular and brands preloads ~5.6 s. Only `solid` — the header/hero/button
 * icons — is preloaded now. The other two keep `font-display: swap` and load when a glyph needs them.
 */

const config = readFileSync('nuxt.config.ts', 'utf8')
const block = config.slice(config.indexOf('const iconFontPreloads = ['), config.indexOf('const analyticsRetention'))

test('only the solid icon font is preloaded', () => {
  const files = [...block.matchAll(/file: '([^']+)'/g)].map(match => match[1])
  assert.deepEqual(files, ['fa-solid-900.woff2'])
})

test('the preload is a well-formed font preload (as=font, crossorigin, woff2)', () => {
  assert.match(block, /as: 'font' as const/)
  assert.match(block, /crossorigin: 'anonymous' as const/)
  assert.match(block, /type: 'font\/woff2'/)
})

test('the two fonts that are no longer preloaded still load on demand and never block text', () => {
  for (const family of ['regular', 'brands']) {
    const css = readFileSync(`public/assets/fontawesome/css/${family}.min.css`, 'utf8')
    assert.match(css, /font-display:swap/, `${family}.min.css keeps font-display: swap`)
    assert.ok(config.includes('ICON_FAMILIES'), 'the stylesheets are still linked, so the font loads when used')
  }
  assert.match(config, /const ICON_FAMILIES = \['solid', 'regular', 'brands'\]/)
})
