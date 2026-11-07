import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import test from 'node:test'
import { COLOR_TOKENS } from '../shared/color-tokens.ts'

/**
 * Lighthouse on production (2026-11-07) failed `color-contrast` on /news for two things:
 * the "featured" badge (white on #689F38, ~3.2:1) and the pagination caption (#6F7F6C on white,
 * ~4.2:1). Both now use tokens that clear WCAG AA (4.5:1 for small text). The ratios are computed
 * from the real token table, so changing a token to something paler turns this red.
 */

const luminance = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = Number.parseInt(hex.slice(i, i + 2), 16) / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

test('the caption color (ink-soft) and the badge background (brand-600) clear AA against white', () => {
  assert.ok(contrast(COLOR_TOKENS['ink-soft']!, '#ffffff') >= 4.5, `ink-soft on white: ${contrast(COLOR_TOKENS['ink-soft']!, '#ffffff').toFixed(2)}`)
  assert.ok(contrast(COLOR_TOKENS['brand-600']!, '#ffffff') >= 4.5, `white on brand-600: ${contrast(COLOR_TOKENS['brand-600']!, '#ffffff').toFixed(2)}`)
})

test('the two colors that failed AA are not used in the public app any more', () => {
  const found = (pattern: string) => {
    try {
      return execFileSync('git', ['grep', '-n', '-F', pattern, '--', 'app'], { encoding: 'utf8' }).trim()
    } catch { return '' }
  }
  assert.equal(found('text-[#6F7F6C]'), '', 'small caption text uses text-ink-soft')
  const badge = found('bg-[#689F38]').split('\n').filter(line => line && !line.includes('hover:bg-[#689F38]'))
  assert.deepEqual(badge, [], 'a white-text badge on #689F38 is 3.2:1 — use bg-brand-600 (hover on an admin button is the only remaining use)')
})
