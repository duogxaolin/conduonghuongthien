import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * What the browser and the Docker image are asked to carry.
 *
 * Two things here fail silently rather than loudly, which is why they are
 * pinned: an icon family that is used but not linked renders as a blank box,
 * and a vendor folder that is not ignored quietly adds a hundred megabytes to
 * every image build.
 */

const root = fileURLToPath(new URL('../', import.meta.url))
const read = (path: string) => readFileSync(join(root, path), 'utf8')

const nuxtConfig = read('nuxt.config.ts')

// ─── FontAwesome families ────────────────────────────────────────────────────
const ALL_FAMILIES = ['solid', 'regular', 'light', 'thin', 'duotone', 'brands', 'sharp']

function familiesUsedInSource(): Set<string> {
  const used = new Set<string>()
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) { walk(path); continue }
      if (!/\.(vue|ts|js)$/.test(entry.name)) continue
      const source = readFileSync(join(root, path), 'utf8')
      for (const family of ALL_FAMILIES) {
        // The trailing guard matters: fa-lightbulb is an icon name, not the
        // Light family, and matching it would pull in a font nothing needs.
        if (new RegExp(`\\bfa-${family}(?![a-z-])`).test(source)) used.add(family)
      }
    }
  }
  walk('app')
  return used
}

test('every icon family the templates use has its stylesheet linked', () => {
  const declared = new Set(
    [...nuxtConfig.matchAll(/const ICON_FAMILIES = \[([^\]]*)\]/g)]
      .flatMap(m => [...m[1].matchAll(/'([a-z-]+)'/g)].map(x => x[1])),
  )
  assert.ok(declared.size > 0, 'ICON_FAMILIES is no longer declared in nuxt.config.ts')

  for (const family of familiesUsedInSource()) {
    assert.ok(declared.has(family), `fa-${family} is used in app/ but not linked — those icons render blank`)
  }
})

test('no icon family is loaded that nothing uses', () => {
  const declared = [...nuxtConfig.matchAll(/const ICON_FAMILIES = \[([^\]]*)\]/g)]
    .flatMap(m => [...m[1].matchAll(/'([a-z-]+)'/g)].map(x => x[1]))
  const used = familiesUsedInSource()
  for (const family of declared) {
    assert.ok(used.has(family), `fa-${family} is linked but unused — drop it from ICON_FAMILIES`)
  }
})

test('the combined icon stylesheet is not the load-everything bundle', () => {
  assert.doesNotMatch(nuxtConfig, /fontawesome\/css\/all\.min\.css/, 'back on all.min.css')
  assert.match(nuxtConfig, /fontawesome\/css\/\$\{name\}\.min\.css/)
  // The icon map itself must still be there or no icon resolves at all.
  assert.match(nuxtConfig, /\['fontawesome', \.\.\.ICON_FAMILIES\]/)
})

test('the linked icon stylesheets exist on disk', () => {
  const families = [...nuxtConfig.matchAll(/const ICON_FAMILIES = \[([^\]]*)\]/g)]
    .flatMap(m => [...m[1].matchAll(/'([a-z-]+)'/g)].map(x => x[1]))
  for (const name of ['fontawesome', ...families]) {
    const path = `public/assets/fontawesome/css/${name}.min.css`
    assert.ok(statSync(join(root, path)).size > 0, `missing or empty: ${path}`)
  }
})

// ─── Build context ───────────────────────────────────────────────────────────
test('the unused FontAwesome bundles stay out of git and out of the image', () => {
  // 113MB of SVG-JS the site never loads. Ignored in one file but not the
  // other is the easy mistake, so both are asserted together.
  for (const file of ['.gitignore', '.dockerignore']) {
    const source = read(file)
    for (const dir of ['js', 'sprites', 'svgs', 'less', 'scss', 'metadata']) {
      assert.match(
        source,
        new RegExp(`public/assets/fontawesome/${dir}`),
        `${file} does not exclude public/assets/fontawesome/${dir}`,
      )
    }
  }
})

// ─── Webfont hosting ─────────────────────────────────────────────────────────
test('a self-hosted Inter takes precedence over the Google CDN', () => {
  assert.match(nuxtConfig, /existsSync\(selfHostedFontCss\)/, 'the self-hosting switch is gone')
  assert.match(nuxtConfig, /'\/assets\/fonts\/inter\.css'/)
  // The CDN must remain the fallback: dropping it before the fonts are fetched
  // would leave the site with no Inter at all.
  assert.match(nuxtConfig, /fonts\.googleapis\.com\/css2\?family=Inter/)
})

test('the fetch script writes where nuxt.config looks', () => {
  const script = read('scripts/fetch-fonts.mjs')
  assert.match(script, /'public', 'assets', 'fonts'/)
  assert.match(script, /'inter\.css'/)
  assert.match(script, /woff2/)
})

test('body text stays legible when no webfont loads at all', () => {
  const css = read('app/assets/css/main.css')
  const stack = /font-family:\s*'Inter',([^;]*);/s.exec(css)?.[1] ?? ''
  assert.ok(stack.includes('sans-serif'), 'the font stack has no generic fallback')
  assert.ok(
    stack.split(',').length >= 4,
    `Inter falls straight through to a generic family: ${stack.trim()}`,
  )
})
