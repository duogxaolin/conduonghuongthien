/**
 * Semantic colour tokens: the ONE table behind `tailwind.config.js` `theme.extend.colors`
 * and `scripts/codemod-hex-tokens.ts` (wave3-long-term D-TOKENS). The config spreads it
 * and the codemod inverts it, so a value cannot differ between the two.
 *
 * Rules, all pinned by tests/tailwind-color-tokens.test.ts:
 * - a token maps one exact value, lowercase 6-digit hex;
 * - values come from `openspec/ui-dna.md` for the role the token names. Where ui-dna
 *   and the design table disagree, ui-dna wins (ink, ink-secondary, surface);
 * - near-duplicates of a value (`#f8faf8` next to `#f8faf7`) get NO token here.
 *   Merging them changes pixels and is decision D-T1, made by the user, not by the
 *   codemod;
 * - no two tokens share a value, so the codemod never has to choose a name.
 *
 * Flat keys (`'brand-700'`, not `{ brand: { 700 } }`): Tailwind flattens nested
 * palettes to exactly these names anyway, and a flat table is what the codemod needs.
 *
 * Do not write example class names in this file's comments: Tailwind scans `shared/`
 * for class names, and every one it finds becomes generated CSS.
 */
export const COLOR_TOKENS = Object.freeze({
  // Greens. 950/900/700 are the admin palette (heading, hover/dark, primary action);
  // 600 is the public primary green and the focus-ring colour (3:1 on white).
  'brand-950': '#122815',
  'brand-900': '#1e4620',
  'brand-700': '#2c6e33',
  'brand-600': '#4a6741',

  // Text: main content, secondary content (ui-dna public), muted (ui-dna admin secondary).
  ink: '#1e251c',
  'ink-secondary': '#4a5545',
  'ink-muted': '#667768',

  // Borders: the admin card border, and the stronger form-control border.
  line: '#e2ece3',
  'line-strong': '#c8d6c9',

  // Backgrounds: the light page background (ui-dna), and the pale green tint.
  surface: '#f8faf7',
  'surface-tint': '#f0f7f1',

  // Dangerous actions and errors.
  danger: '#d12420',
} as const)

export type ColorToken = keyof typeof COLOR_TOKENS
