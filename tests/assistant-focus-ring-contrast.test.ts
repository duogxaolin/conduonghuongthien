import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

/**
 * /assistant: every solid focus ring (`focus-visible:ring-[#hex]`) must reach 3:1
 * against the light surfaces it sits on (WCAG 1.4.11 — non-text contrast).
 *
 * The conversation switch / delete buttons (and the new-chat, source-chip and
 * retry buttons) used `#7CB342`, the DNA's secondary green: 2.50:1 on white, so a
 * keyboard user could barely see which conversation had focus. They now use the
 * primary `#4A6741`. Same rule as tests/focus-ring-contrast.test.ts for the
 * public layout; checked against every light surface used on this page.
 */

function luminance(hex: string): number {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

/** Surfaces behind the focusable controls on /assistant (sidebar, active row, header, source panel). */
const SURFACES = ['FFFFFF', 'FCFDFC', 'F0F7F1', 'F8FAF8', 'F0F6EF']

test('assistant.vue: every solid focus ring reaches 3:1 on the page\'s light surfaces', () => {
  const source = readFileSync(new URL('../app/pages/assistant.vue', import.meta.url), 'utf8')
  const rings = [...source.matchAll(/focus-visible:ring-\[#([0-9A-Fa-f]{6})\](?!\/)/g)].map((m) => m[1]!)
  assert.ok(rings.length >= 5, `expected the switch/delete/new-chat/chip/retry rings, found ${rings.length}`)
  for (const hex of rings) {
    for (const surface of SURFACES) {
      const ratio = contrast(hex, surface)
      assert.ok(ratio >= 3, `#${hex} only ${ratio.toFixed(2)}:1 on #${surface}`)
    }
  }
})
