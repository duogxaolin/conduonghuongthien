import { COLOR_TOKENS, type ColorToken } from '../shared/color-tokens.ts'

/**
 * Solid focus rings in a source file, for the contrast tests (tests/focus-ring-contrast.test.ts,
 * tests/assistant-focus-ring-contrast.test.ts).
 *
 * A ring is written either as an arbitrary hex (`focus-visible:ring-[#4A6741]`) or, after the
 * colour-token migration (wave3-long-term D-TOKENS), as a token (`focus-visible:ring-brand-600`).
 * Matching only the hex form would let a migrated file pass with nothing checked, so a token
 * is resolved through COLOR_TOKENS to the value Tailwind compiles it to. A translucent halo
 * (`/30`, `/[0.35]`) is not the indicator and is skipped, as before.
 */
const TOKEN_ALT = (Object.keys(COLOR_TOKENS) as ColorToken[])
  .sort((a, b) => b.length - a.length)
  .map((token) => token.replace(/-/g, '\\-'))
  .join('|')
const SOLID_RING = new RegExp(`focus-visible:ring-(?:\\[#([0-9A-Fa-f]{6})\\]|(${TOKEN_ALT}))(?![\\w/-])`, 'g')

/** The colour of every solid focus ring in `source`, as 6-digit hex without `#`. */
export function solidFocusRings(source: string): string[] {
  return [...source.matchAll(SOLID_RING)].map((m) => m[1] ?? COLOR_TOKENS[m[2] as ColorToken].slice(1))
}
