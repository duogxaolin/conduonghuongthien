import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

/**
 * Upper-case Vietnamese letters with two marks stacked above (Ổ, Ỗ, Ồ, Ấ, Ầ, Ẩ, Ẫ,
 * Ế, Ề, Ể, Ễ, Ố…) rise above the line box of a tight `line-height`. Inside a box
 * that clips (`line-clamp-*`, `truncate`, `overflow-hidden`) the top mark is cut
 * off: the header subtitle read "CÔNG THÔNG TIN … HÔ TRỢ … CỘNG ĐÔNG" instead of
 * "CỔNG … HỖ TRỢ … CỘNG ĐỒNG" (báo lỗi kèm ảnh, 2026-10-23).
 *
 * Measured with the repo's Inter in Chromium: stacked capitals reach 1.11em above
 * the baseline, and the room above the first line of a clip box is
 * (line-height + 0.73) / 2 + top padding — so `leading-snug` alone (1.375) still
 * clips; it takes line-height ≥ ~1.5 or top padding.
 *
 * Source-text guard over public components: an `uppercase` element that clips
 * must carry top padding (`pt-`/`py-`/`p-`) or a loose leading (`normal`,
 * `relaxed`, `loose`, `[1.5+]`). It proves the class combination, not the
 * rendering — the fix was checked in a browser.
 */
function vueFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return path.includes('/admin') ? [] : vueFiles(path)
    return entry.name.endsWith('.vue') ? [path] : []
  })
}

test('no public upper-case text clips its line box with a tight line-height', () => {
  const offenders: string[] = []
  for (const file of [...vueFiles('app/components'), ...vueFiles('app/pages'), 'app/layouts/default.vue']) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/class="([^"]*)"/g)) {
      const classes = match[1]!.split(/\s+/)
      const clips = classes.some(c => /^(line-clamp-\d|truncate|overflow-hidden)$/.test(c))
      const padded = classes.some(c => /^p[ty]?-/.test(c))
      const loose = classes.some(c => /^leading-(normal|relaxed|loose|\[(1\.[5-9]\d*|[2-9](\.\d+)?)\])$/.test(c))
      if (clips && !padded && !loose && classes.includes('uppercase')) {
        offenders.push(`${file}:${source.slice(0, match.index).split('\n').length}`)
      }
    }
  }
  assert.deepEqual(offenders, [], 'stacked Vietnamese capitals would lose their top mark — add top padding (pt-[0.2em]) or a leading of 1.5+')
})

test('the header subtitle keeps room above its first line', () => {
  const header = readFileSync('app/components/layout/DefaultHeader.vue', 'utf8')
  const subtitle = /<p class="([^"]*)">\s*\{\{ t\('portal_subtitle'\) \}\}/.exec(header)
  assert.ok(subtitle, 'subtitle element found')
  assert.match(subtitle[1]!, /\bleading-snug\b/)
  assert.match(subtitle[1]!, /\bpt-\[0\.2em\]/)
})

test('the livestream title (data, may be all caps) keeps room above its line', () => {
  const hero = readFileSync('app/components/LiveHero.vue', 'utf8')
  const title = /<h1 class="([^"]*)">\s*\{\{ session\.title \}\}/.exec(hero)
  assert.ok(title, 'livestream title element found')
  assert.match(title[1]!, /\btruncate\b/)
  assert.match(title[1]!, /\bpt-\[0\.15em\]/)
})
