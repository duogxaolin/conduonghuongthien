/**
 * Approved colour merges: arbitrary hexes that the user decided to fold into a semantic
 * token although the value differs (wave3-long-term decision D-T1, task 3.7). ONE table,
 * read by `scripts/codemod-hex-tokens.ts --merges` and by the tests.
 *
 * Unlike `shared/color-tokens.ts`, every entry here CHANGES pixels, by the colour
 * difference it records: `dE` is CIEDE2000 between the hex and the token's value,
 * rounded to 2 decimals (tests/tailwind-color-tokens.test.ts recomputes each one).
 *
 * Three rules, each with its own bound (pinned by the same test):
 *   near    — a near-duplicate of one of the first twelve tokens, that token being the
 *             nearest: dE below 2.0 (decision part A);
 *   member  — a near-duplicate of one of the ten tokens named by D-T1: dE at most 2.0
 *             from that token's value (part B);
 *   fold    — a whole group the user folded into a new token: its most-used colour (the
 *             `anchor`) and that colour's near-duplicates, each with dE at most 3.75 to the
 *             TOKEN value (part B, approved folds).
 *
 * Not here, on purpose (they stay arbitrary hexes):
 *   - colours 2.0–3.0 from their nearest token, and rare colours (fewer than 8 uses);
 *   - the other reds, which carry their own meaning: #a32924, #b42318, #b71c1c, #b0403c;
 *   - fold entries whose distance to the token exceeded the approved figure once measured
 *     against the token instead of the group anchor: the #2d5a27 group (5.7–6.7 from the
 *     dark brand green) and four pale reds of the #fff4f3 group (4.2–5.6 from the error
 *     panel red). They wait for a new decision.
 *
 * Use counts (`// n`) are the arbitrary-hex occurrences measured on 81bfb5e, before the
 * merge. Do not write example class names in this file's comments: Tailwind scans
 * `shared/` for class names, and every one it finds becomes generated CSS.
 */
import type { ColorToken } from './color-tokens'

export type MergeRule = 'near' | 'member' | 'fold'

export interface ColorMerge {
  /** The token the hex is rewritten to. */
  readonly token: ColorToken
  /** CIEDE2000 between the hex and the token's value, 2 decimals. */
  readonly dE: number
  readonly rule: MergeRule
  /** `fold` only: the anchor of the folded group (the anchor's own entry included). */
  readonly anchor?: string
}

const near = (token: ColorToken, dE: number): ColorMerge => Object.freeze({ token, dE, rule: 'near' })
const member = (token: ColorToken, dE: number): ColorMerge => Object.freeze({ token, dE, rule: 'member' })
const fold = (token: ColorToken, dE: number, anchor: string): ColorMerge => Object.freeze({ token, dE, rule: 'fold', anchor })

/** Lowercase `#rrggbb` → the approved merge. */
export const COLOR_MERGES: Readonly<Record<string, ColorMerge>> = Object.freeze({
  // line
  '#e2e8df': near('line', 1.79), // 136
  '#ebf3e8': near('line', 1.89), // 34
  '#dfe9e0': near('line', 0.65), // 32
  '#dde6dc': near('line', 1.39), // 28
  '#e5ede3': near('line', 0.92), // 28
  '#eaf4ea': near('line', 1.72), // 25
  '#e1e8e0': near('line', 1.53), // 20
  '#dce8dd': near('line', 1.58), // 17
  '#e8f0e8': near('line', 1.38), // 16
  '#dce5db': near('line', 1.6), // 13
  '#dbe7dc': near('line', 1.73), // 12
  '#e4ece4': near('line', 0.98), // 12
  '#dde6de': near('line', 1.38), // 10
  '#e1eadf': near('line', 1.0), // 8
  '#e4ede2': near('line', 0.93), // 8
  '#e6f2e6': near('line', 1.9), // 8
  '#e4eee2': near('line', 1.31), // 7
  '#e2ede3': near('line', 0.63), // 5
  '#dce6dc': near('line', 1.4), // 3
  '#e8efe6': near('line', 1.46), // 3
  '#e2ebe0': near('line', 0.92), // 2
  '#e8eee6': near('line', 1.89), // 2
  '#e1e8df': near('line', 1.43), // 1
  '#e5ede2': near('line', 1.14), // 1
  '#e8f2e6': near('line', 1.75), // 1
  '#e8f4e9': near('line', 1.97), // 1
  // line-strong
  '#d0ddd1': near('line-strong', 1.8), // 36
  '#c7d2c2': near('line-strong', 1.81), // 4
  '#c5d3c7': near('line-strong', 0.8), // 2
  // surface
  '#f8faf8': near('surface', 0.51), // 128
  '#f4f7f4': near('surface', 0.81), // 93
  '#fafcfa': near('surface', 0.66), // 33
  '#f7faf6': near('surface', 0.76), // 22
  '#f0f4f0': near('surface', 1.76), // 18
  '#fcfdfc': near('surface', 1.41), // 17
  '#f7fbf7': near('surface', 1.15), // 14
  '#fbfdfb': near('surface', 0.8), // 5
  '#f7faf7': near('surface', 0.47), // 4
  '#f7f9f7': near('surface', 0.54), // 3
  '#f8fbf8': near('surface', 0.5), // 3
  '#f4f6f4': near('surface', 0.94), // 2
  '#f5f8f4': near('surface', 0.89), // 2
  '#f5f8f5': near('surface', 0.65), // 2
  '#f7f9f6': near('surface', 0.2), // 2
  '#f9faf8': near('surface', 0.78), // 2
  '#eef1ee': near('surface', 1.95), // 1
  '#f5f7f5': near('surface', 0.78), // 1
  '#f6f8f6': near('surface', 0.64), // 1
  '#f6faf6': near('surface', 1.15), // 1
  '#f7faf5': near('surface', 1.18), // 1
  // surface-tint
  '#eef2ec': near('surface-tint', 1.59), // 124
  '#eef2ee': near('surface-tint', 1.96), // 121
  '#edf3ed': near('surface-tint', 0.89), // 43
  '#eef4ec': near('surface-tint', 1.12), // 29
  '#f2f7f0': near('surface-tint', 0.91), // 26
  '#eef7ee': near('surface-tint', 1.68), // 24
  '#eef3ee': near('surface-tint', 1.28), // 13
  '#f0f5ee': near('surface-tint', 0.97), // 12
  '#f0f6ef': near('surface-tint', 0.6), // 12
  '#ebf1ea': near('surface-tint', 1.35), // 9
  '#eef4ed': near('surface-tint', 0.83), // 8
  '#f1f5f0': near('surface-tint', 1.5), // 7
  '#e8efe8': near('surface-tint', 1.75), // 5
  '#eef3ed': near('surface-tint', 1.14), // 5
  '#f0f4ef': near('surface-tint', 1.55), // 5
  '#f3f7f1': near('surface-tint', 1.32), // 4
  '#f4f9f0': near('surface-tint', 1.54), // 4
  '#edf7ee': near('surface-tint', 1.95), // 3
  '#eef7ef': near('surface-tint', 1.32), // 3
  '#eef5eb': near('surface-tint', 1.84), // 2
  '#eef6ef': near('surface-tint', 0.72), // 2
  '#f2f6f0': near('surface-tint', 1.32), // 2
  '#f5faf3': near('surface-tint', 1.14), // 2
  '#e9efea': near('surface-tint', 1.74), // 1
  '#eaf2ea': near('surface-tint', 1.54), // 1
  '#edf2ec': near('surface-tint', 1.28), // 1
  '#edf3ea': near('surface-tint', 1.59), // 1
  '#eef4ee': near('surface-tint', 0.71), // 1
  '#eff6ee': near('surface-tint', 0.94), // 1
  '#f0f5f0': near('surface-tint', 1.1), // 1
  '#f2f7f2': near('surface-tint', 1.06), // 1
  '#f4f9f4': near('surface-tint', 1.18), // 1
  '#f4faf5': near('surface-tint', 0.97), // 1
  '#f4fbf4': near('surface-tint', 0.92), // 1
  // brand-950
  '#0f2311': near('brand-950', 1.59), // 1
  // brand-900
  '#1a441e': near('brand-900', 0.77), // 2
  '#1d4a22': near('brand-900', 1.41), // 2
  // brand-700
  '#2e6b32': near('brand-700', 1.09), // 4
  // ink-secondary
  '#4a5746': near('ink-secondary', 1.08), // 4
  '#485645': near('ink-secondary', 1.33), // 2
  // ink-muted
  '#6b7967': near('ink-muted', 1.9), // 8

  // ---- the ten D-T1 tokens
  // brand-800, with the approved fold of the #385932 group
  '#385132': member('brand-800', 0.65), // 25
  '#365130': member('brand-800', 0.57), // 3
  '#3d5636': member('brand-800', 1.76), // 2
  '#385932': fold('brand-800', 3.2, '#385932'), // 47
  '#365730': fold('brand-800', 2.8, '#385932'), // 7
  // ink-admin
  '#2c3e2d': member('ink-admin', 0.44), // 3
  // ink-soft, with the approved fold of the #556450 group
  '#5a6b5b': member('ink-soft', 1.64), // 1
  '#5c6b55': member('ink-soft', 1.37), // 1
  '#5d6d59': member('ink-soft', 0.9), // 1
  '#556450': fold('ink-soft', 2.95, '#556450'), // 34
  '#576653': fold('ink-soft', 2.29, '#556450'), // 7
  '#556653': fold('ink-soft', 2.19, '#556450'), // 6
  '#556655': fold('ink-soft', 2.39, '#556450'), // 4
  // ink-faint
  '#8a9a88': member('ink-faint', 1.6), // 10
  '#88998a': member('ink-faint', 0.7), // 1
  '#8a9a8b': member('ink-faint', 0.41), // 1
  '#8a9a8d': member('ink-faint', 0.42), // 1
  // danger-bg, with the approved fold of the #fff4f3 group. #fff4f3 itself (3.75) stays hex:
  // folding it would split it from its near twin #fff5f4 (0.45 apart), which is held too.
  '#fce8e8': member('danger-bg', 1.11), // 12
  '#fdecec': member('danger-bg', 1.31), // 7
  '#fbe5e3': member('danger-bg', 1.39), // 2
  '#fbe6e6': member('danger-bg', 1.45), // 2
  '#fdecea': member('danger-bg', 1.12), // 2
  '#fdf0f0': fold('danger-bg', 2.76, '#fff4f3'), // 4
  '#fef2f2': fold('danger-bg', 3.24, '#fff4f3'), // 2
  '#fff0ef': fold('danger-bg', 2.03, '#fff4f3'), // 2
  '#fdf1f1': fold('danger-bg', 3.17, '#fff4f3'), // 1
  // warn-ink
  '#8a6500': member('warn-ink', 1.81), // 2
})
