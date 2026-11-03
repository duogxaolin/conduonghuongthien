/**
 * Semantic colour tokens: the ONE table behind `tailwind.config.js` `theme.extend.colors`
 * and `scripts/codemod-hex-tokens.ts` (wave3-long-term D-TOKENS). The config spreads it
 * and the codemod inverts it, so a value cannot differ between the two.
 *
 * Rules, all pinned by tests/tailwind-color-tokens.test.ts:
 * - a token maps one exact value, lowercase 6-digit hex;
 * - values come from `openspec/ui-dna.md` for the role the token names. Where ui-dna
 *   and the design table disagree, ui-dna wins (ink, ink-secondary, surface);
 * - the ten tokens below the first twelve were named by the user's D-T1 decision
 *   (task 3.7): each is the most-used colour of a group that had no name, kept at its
 *   exact value, so renaming that value is pixel-neutral;
 * - near-duplicates of a value (`#f8faf8` next to `#f8faf7`) get NO token here.
 *   Folding them into a token changes pixels; the folds the user approved (D-T1) are
 *   listed, with their colour difference, in `shared/color-merges.ts`, and only the
 *   codemod's opt-in merge mode applies them;
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

  // ---- D-T1 (task 3.7): named after the user's decision, each at its most-used value.
  // Greens: the light admin green (the old admin palette's light shade: text on dark green,
  // soft borders and fills), and the public dark green of ui-dna.
  'brand-300': '#8ed694',
  'brand-800': '#385130',
  // The secondary green of ui-dna. Decorative only: it reaches 2.5:1 on white, so it must
  // never colour a keyboard-focus indicator of any kind (CLAUDE.md, focus colour rule).
  // tests/focus-ring-no-secondary-green.test.ts fails on either spelling, and the codemod
  // never emits this name for those utilities. Text on white is NOT enforced: a few older
  // uses (qa-documents eyebrow, rank numbers) already do it — a separate a11y task.
  accent: '#7cb342',

  // Text: the strongest heading text, the admin body text, the public secondary text
  // (CLAUDE.md: 4.5:1 or better on every light surface in use), and the faint hint text.
  'ink-strong': '#172516',
  'ink-admin': '#2c3e2e',
  'ink-soft': '#5a6c58',
  'ink-faint': '#8a9a8c',

  // Errors and warnings: the softer red of error text, the pale red of an error panel,
  // and the brown-amber of warning text.
  'danger-soft': '#b04a4a',
  'danger-bg': '#ffebe9',
  'warn-ink': '#8a6412',
} as const)

export type ColorToken = keyof typeof COLOR_TOKENS

/**
 * Tokens below 3:1 on white that may only decorate: never the colour of a keyboard-focus
 * indicator in any form (see the indicator rule of scripts/codemod-hex-tokens.ts). The
 * codemod leaves such a hex as it is instead of emitting one of these names there, and
 * tests/focus-ring-no-secondary-green.test.ts fails on either spelling.
 */
export const DECORATIVE_ONLY_TOKENS: readonly ColorToken[] = Object.freeze(['accent'])
