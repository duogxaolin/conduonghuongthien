/**
 * Semantic colour tokens in `tailwind.config.js` (wave3-long-term D-TOKENS, task 3.1).
 *
 * The tokens are the vocabulary `scripts/codemod-hex-tokens.ts` rewrites `bg-[#2c6e33]`
 * into. That rewrite is only pixel-neutral if four things hold, and each test below
 * pins one of them against the REAL config, loaded the way Nuxt loads it (jiti — the
 * file is CommonJS inside a `"type": "module"` package, so a plain `import` fails):
 *
 *   1. Every token maps exactly one value, and the value is the one `openspec/ui-dna.md`
 *      names for that role (or, for the ten D-T1 tokens, the most-used colour of the group
 *      the user named). Near-duplicates (`#f8faf8` vs `#f8faf7`) are NOT folded into the
 *      token table — the folds the user approved (D-T1) are a separate table,
 *      `shared/color-merges.ts`, pinned at the end of this file.
 *   2. The config's colours come from the one table the codemod also reads
 *      (`shared/color-tokens.ts`), so the two cannot drift.
 *   3. No two names share a value unless declared an alias here — otherwise the
 *      codemod would have to pick a name for that value.
 *   4. Each token generates, for every colour utility the codemod emits, exactly the
 *      CSS the arbitrary hex it replaces generated (same declarations, `/30` and
 *      `/[0.35]` included). That is the pixel-preservation proof at the CSS level.
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import { before, describe, test } from 'node:test'
import { COLOR_MERGES } from '../shared/color-merges.ts'
import { COLOR_TOKENS, DECORATIVE_ONLY_TOKENS } from '../shared/color-tokens.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const CONFIG_PATH = path.join(ROOT, 'tailwind.config.js')

// The same tailwindcss / postcss / jiti that the build uses, reached through the
// direct dependency `tailwindcss` (not whatever copy happens to be hoisted).
const requireHere = createRequire(import.meta.url)
const tailwindcss = requireHere('tailwindcss')
const requireFromTailwind = createRequire(requireHere.resolve('tailwindcss'))
const postcss = requireFromTailwind('postcss')
const createJiti = requireFromTailwind('jiti') as (file: string, options: Record<string, unknown>) => (id: string) => unknown
const defaultColorNames = Object.keys(requireHere('tailwindcss/colors') as Record<string, unknown>)

type ColorTree = { [key: string]: string | ColorTree }
type TailwindConfig = { theme?: { colors?: unknown; extend?: { colors?: ColorTree } }; safelist?: unknown }

function loadConfig(): TailwindConfig {
  const jiti = createJiti(CONFIG_PATH, { interopDefault: true, cache: false, requireCache: false })
  return jiti(CONFIG_PATH) as TailwindConfig
}

/** `{ brand: { 700: '#…' }, ink: { DEFAULT: '#…' } }` → `{ 'brand-700': '#…', ink: '#…' }` — Tailwind's own naming. */
function flatten(tree: ColorTree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(tree)) {
    const name = key === 'DEFAULT' ? prefix : prefix ? `${prefix}-${key}` : key
    if (typeof value === 'string') out[name] = value
    else Object.assign(out, flatten(value, name))
  }
  return out
}

/**
 * The token table, value by value. Source of each value (counts = `[#hex]` occurrences
 * in `app/`, measured 2026-10-25 on 7b321b5):
 *
 * | token | value | ui-dna.md role | uses |
 * |---|---|---|---|
 * | brand-950 | #122815 | admin heading | 497 |
 * | brand-900 | #1e4620 | (admin palette `dark`; ui-dna silent) | 331 |
 * | brand-700 | #2c6e33 | admin primary button | 1408 |
 * | brand-600 | #4a6741 | public primary green / focus ring | 443 |
 * | ink | #1e251c | public main content | 80 |
 * | ink-secondary | #4a5545 | public secondary content | 84 |
 * | ink-muted | #667768 | admin secondary text | 793 |
 * | line | #e2ece3 | admin border | 497 |
 * | line-strong | #c8d6c9 | (ui-dna silent) | 401 |
 * | surface | #f8faf7 | public light background | 55 |
 * | surface-tint | #f0f7f1 | (ui-dna silent) | 274 |
 * | danger | #d12420 | "red for danger and errors" | 120 |
 *
 * `ink`, `ink-secondary` and `surface` follow ui-dna.md, which disagrees with the
 * design.md table (`#2c3e2e`, `#5a6c58`, `#f8faf8`). The user's D-T1 decision (task 3.7)
 * named the first two (`ink-admin`, `ink-soft`) and folded the third into `surface`.
 *
 * The ten D-T1 tokens: each is the most-used colour of a group the user named, at its exact
 * value (uses = arbitrary-hex occurrences on 81bfb5e, before the merge):
 *
 * | token | value | role | uses |
 * |---|---|---|---|
 * | ink-admin | #2c3e2e | admin body text | 140 |
 * | ink-soft | #5a6c58 | public secondary text (CLAUDE.md) | 110 |
 * | brand-300 | #8ed694 | light admin green (old admin palette `light`) | 98 |
 * | accent | #7cb342 | ui-dna secondary green — decorative only, 2.5:1 on white | 82 |
 * | danger-soft | #b04a4a | softer red of error text | 80 |
 * | ink-faint | #8a9a8c | faint hint text | 66 |
 * | brand-800 | #385130 | ui-dna public dark green | 47 |
 * | danger-bg | #ffebe9 | pale red of an error panel | 29 |
 * | ink-strong | #172516 | strongest heading text | 53 |
 * | warn-ink | #8a6412 | warning text | 48 |
 */
const EXPECTED: Record<string, string> = {
  'brand-950': '#122815',
  'brand-900': '#1e4620',
  'brand-700': '#2c6e33',
  'brand-600': '#4a6741',
  ink: '#1e251c',
  'ink-secondary': '#4a5545',
  'ink-muted': '#667768',
  line: '#e2ece3',
  'line-strong': '#c8d6c9',
  surface: '#f8faf7',
  'surface-tint': '#f0f7f1',
  danger: '#d12420',
  // D-T1 (task 3.7)
  'brand-300': '#8ed694',
  'brand-800': '#385130',
  accent: '#7cb342',
  'ink-strong': '#172516',
  'ink-admin': '#2c3e2e',
  'ink-soft': '#5a6c58',
  'ink-faint': '#8a9a8c',
  'danger-soft': '#b04a4a',
  'danger-bg': '#ffebe9',
  'warn-ink': '#8a6412',
}
/** The first twelve tokens (D-TOKENS); the rest were named by D-T1. */
const ORIGINAL_TOKENS = ['brand-950', 'brand-900', 'brand-700', 'brand-600', 'ink', 'ink-secondary', 'ink-muted', 'line', 'line-strong', 'surface', 'surface-tint', 'danger']

/**
 * Names that are allowed to share a value with another name: `alias → canonical`.
 * Empty on purpose — the old `admin-*` palette (0 uses) was folded into the tokens,
 * not aliased. Adding an alias is a decision the codemod has to know about, so it has
 * to be declared here.
 */
const DECLARED_ALIASES: Record<string, string> = {}

/** Every colour utility family the codemod rewrites (`<prefix>-[#hex]` → `<prefix>-<token>`). */
const PREFIXES = [
  'bg', 'text',
  'border', 'border-x', 'border-y', 'border-s', 'border-e', 'border-t', 'border-r', 'border-b', 'border-l',
  'ring', 'ring-offset', 'outline', 'divide', 'from', 'via', 'to',
  'fill', 'stroke', 'placeholder', 'caret', 'accent', 'decoration', 'shadow',
]
const OPACITIES = ['', '/30', '/[0.35]']

const rgbTriple = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(' ')

/** Compile `raw` with the real config (content replaced) → unescaped selector → declarations. */
async function compile(config: TailwindConfig, raw: string): Promise<Map<string, string[]>> {
  const result = await postcss([tailwindcss({ ...config, content: [{ raw, extension: 'html' }], safelist: [] })])
    .process('@tailwind utilities;', { from: undefined })
  const rules = new Map<string, string[]>()
  type Node = { type: string; prop?: string; value?: string; important?: boolean }
  postcss.parse(result.css).walkRules((rule: { selectors: string[]; nodes: Node[] }) => {
    // postcss keeps `!important` out of `value`, on its own flag.
    const decls = rule.nodes.filter((n) => n.type === 'decl').map((n) => `${n.prop}:${n.value}${n.important ? ' !important' : ''}`).join(';')
    for (const selector of rule.selectors) {
      const key = selector.replace(/\\(.)/g, '$1')
      rules.set(key, [...(rules.get(key) ?? []), decls])
    }
  })
  return rules
}

/** The rules generated for one class: `<rest of selector>{<declarations>}`, sorted. */
function rulesFor(css: Map<string, string[]>, cls: string): string[] {
  const out: string[] = []
  for (const [selector, declsList] of css) {
    if (!selector.startsWith(`.${cls}`)) continue
    const rest = selector.slice(cls.length + 1)
    if (rest !== '' && !/^[\s:>~+,]/.test(rest)) continue // `.bg-line` must not pick up `.bg-line-strong`
    for (const decls of declsList) out.push(`${rest}{${decls}}`)
  }
  return out.sort()
}

describe('semantic colour tokens in tailwind.config.js', () => {
  let config: TailwindConfig
  let colors: Record<string, string>
  before(() => {
    config = loadConfig()
    colors = flatten(config.theme?.extend?.colors ?? {})
  })

  test('each token has exactly the value ui-dna.md names for its role', () => {
    assert.deepEqual(colors, EXPECTED)
  })

  test('the config colours are the shared table the codemod reads — nothing defined beside it', () => {
    assert.deepEqual(colors, { ...COLOR_TOKENS })
    assert.ok(Object.isFrozen(COLOR_TOKENS), 'COLOR_TOKENS must be frozen so no caller can mutate the shared table')
    // `theme.colors` (not `extend`) would REPLACE Tailwind's palette and drop `white`, `red-500`…
    assert.equal(config.theme?.colors, undefined)
  })

  test('the unused admin-* palette is gone (folded into the tokens, not kept beside them)', () => {
    assert.ok(!Object.keys(colors).some((name) => name === 'admin' || name.startsWith('admin-')))
  })

  test('every token value is a lowercase 6-digit hex', () => {
    for (const [name, value] of Object.entries(colors)) {
      assert.match(value, /^#[0-9a-f]{6}$/, `${name}: ${value}`)
    }
  })

  test('no two names share a value unless declared an alias', () => {
    const byValue = new Map<string, string[]>()
    for (const [name, value] of Object.entries(colors)) byValue.set(value, [...(byValue.get(value) ?? []), name])
    for (const [value, names] of byValue) {
      if (names.length === 1) continue
      const canonical = names.filter((name) => !(name in DECLARED_ALIASES))
      assert.equal(canonical.length, 1, `${value} is shared by ${names.join(', ')} — declare the extra names in DECLARED_ALIASES`)
      for (const alias of names.filter((name) => name in DECLARED_ALIASES)) {
        assert.equal(DECLARED_ALIASES[alias], canonical[0], `${alias} is declared an alias of ${DECLARED_ALIASES[alias]}, but shares ${value} with ${canonical[0]}`)
      }
    }
  })

  test('no token name collides with a Tailwind default colour', () => {
    for (const name of Object.keys(colors)) {
      const family = name.split('-')[0]!
      assert.ok(!defaultColorNames.includes(family), `${name}: "${family}" is already a Tailwind colour`)
    }
  })

  describe('generated CSS', () => {
    let css: Map<string, string[]>
    before(async () => {
      const classes = Object.entries(EXPECTED).flatMap(([name, value]) =>
        PREFIXES.flatMap((prefix) => OPACITIES.flatMap((opacity) => [`${prefix}-[${value}]${opacity}`, `${prefix}-${name}${opacity}`])),
      )
      classes.push('hover:bg-[#2c6e33]', 'hover:bg-brand-700', 'focus-visible:!ring-[#4a6741]/30', 'focus-visible:!ring-brand-600/30')
      css = await compile(config, classes.join(' '))
    })

    test('bg-brand-700 and text-ink-muted/60 compile to the expected rgb', () => {
      assert.deepEqual(rulesFor(css, 'bg-brand-700'), ['{--tw-bg-opacity:1;background-color:rgb(44 110 51 / var(--tw-bg-opacity, 1))}'])
      // `/60` is not in OPACITIES — compiled on its own to show an arbitrary modifier on a token works.
      return compile(config, 'text-ink-muted/60').then((single) => {
        assert.deepEqual(rulesFor(single, 'text-ink-muted/60'), ['{color:rgb(102 119 104 / 0.6)}'])
      })
    })

    for (const [name, value] of Object.entries(EXPECTED)) {
      test(`${name}: every utility family generates the same CSS as the hex it replaces`, () => {
        for (const prefix of PREFIXES) {
          for (const opacity of OPACITIES) {
            const fromHex = rulesFor(css, `${prefix}-[${value}]${opacity}`)
            const fromToken = rulesFor(css, `${prefix}-${name}${opacity}`)
            assert.ok(fromToken.length > 0, `${prefix}-${name}${opacity} generated no CSS`)
            assert.deepEqual(fromToken, fromHex, `${prefix}-${name}${opacity} differs from ${prefix}-[${value}]${opacity}`)
            const joined = fromToken.join(' ')
            assert.ok(joined.includes(rgbTriple(value)) || joined.includes(value), `${prefix}-${name}${opacity} does not carry ${value}: ${joined}`)
          }
        }
      })
    }

    test('variants and !important carry over unchanged', () => {
      assert.deepEqual(rulesFor(css, 'hover:bg-brand-700'), rulesFor(css, 'hover:bg-[#2c6e33]'))
      assert.equal(rulesFor(css, 'hover:bg-brand-700').length, 1)
      assert.deepEqual(rulesFor(css, 'focus-visible:!ring-brand-600/30'), rulesFor(css, 'focus-visible:!ring-[#4a6741]/30'))
      assert.match(rulesFor(css, 'focus-visible:!ring-brand-600/30')[0]!, /!important/)
    })

    test('a token named like a utility prefix still compiles to its colour (accent → accent-color)', () => {
      // `accent-*` is Tailwind's accent-color utility; the colour named `accent` must yield
      // exactly the hex's CSS there, and the colour (not another utility) everywhere else.
      assert.deepEqual(rulesFor(css, 'accent-accent'), ['{accent-color:#7cb342}'])
      assert.deepEqual(rulesFor(css, 'text-accent'), ['{--tw-text-opacity:1;color:rgb(124 179 66 / var(--tw-text-opacity, 1))}'])
    })
  })
})

/** CIEDE2000 between two `#rrggbb` (sRGB, D65), the formula the D-T1 swatch page used. */
function deltaE2000(hexA: string, hexB: string): number {
  const lab = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number]
    const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047
    const y = r * 0.2126 + g * 0.7152 + b * 0.0722
    const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883
    const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))] as const
  }
  const rad = (deg: number) => (deg * Math.PI) / 180
  const deg = (r: number) => (r * 180) / Math.PI
  const [L1, a1, b1] = lab(hexA)
  const [L2, a2, b2] = lab(hexB)
  const Cb = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)))
  const a1p = (1 + G) * a1
  const a2p = (1 + G) * a2
  const C1p = Math.hypot(a1p, b1)
  const C2p = Math.hypot(a2p, b2)
  const h1p = (deg(Math.atan2(b1, a1p)) + 360) % 360
  const h2p = (deg(Math.atan2(b2, a2p)) + 360) % 360
  const dLp = L2 - L1
  const dCp = C2p - C1p
  let dhp = 0
  if (C1p * C2p !== 0) dhp = Math.abs(h2p - h1p) <= 180 ? h2p - h1p : h2p - h1p > 180 ? h2p - h1p - 360 : h2p - h1p + 360
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp / 2))
  const Lbp = (L1 + L2) / 2
  const Cbp = (C1p + C2p) / 2
  let hbp = Math.abs(h1p - h2p) <= 180 ? (h1p + h2p) / 2 : h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2
  if (C1p * C2p === 0) hbp = h1p + h2p
  const T = 1 - 0.17 * Math.cos(rad(hbp - 30)) + 0.24 * Math.cos(rad(2 * hbp)) + 0.32 * Math.cos(rad(3 * hbp + 6)) - 0.2 * Math.cos(rad(4 * hbp - 63))
  const dth = 30 * Math.exp(-(((hbp - 275) / 25) ** 2))
  const RC = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7))
  const SL = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2)
  const SC = 1 + 0.045 * Cbp
  const SH = 1 + 0.015 * Cbp * T
  const RT = -Math.sin(rad(2 * dth)) * RC
  return Math.sqrt((dLp / SL) ** 2 + (dCp / SC) ** 2 + (dHp / SH) ** 2 + RT * (dCp / SC) * (dHp / SH))
}

function contrastOnWhite(hex: string): number {
  const lum = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 1.05 / (0.2126 * lum[0]! + 0.7152 * lum[1]! + 0.0722 * lum[2]! + 0.05)
}

/**
 * The approved merges (`shared/color-merges.ts`, decision D-T1, task 3.7): hexes the codemod's
 * `--merges` folds into a token although they differ. Each entry changes pixels by its `dE`,
 * so each is pinned against the rule the user approved — never more than that.
 */
describe('approved colour merges (shared/color-merges.ts)', () => {
  const entries = Object.entries(COLOR_MERGES)
  const NEW_TOKENS = Object.keys(EXPECTED).filter((name) => !ORIGINAL_TOKENS.includes(name))

  test('the table is not empty, frozen, and keyed by lowercase 6-digit hex', () => {
    // 91 near-duplicates (part A) + 17 members + 12 fold entries (part B), measured on 81bfb5e.
    assert.equal(entries.length, 120)
    assert.ok(Object.isFrozen(COLOR_MERGES))
    for (const [hex, merge] of entries) {
      assert.match(hex, /^#[0-9a-f]{6}$/, hex)
      assert.ok(Object.isFrozen(merge), `${hex}: entry is not frozen`)
    }
  })

  test('every merge target is a real token, and no merged hex is already a token value', () => {
    const values = new Set(Object.values(COLOR_TOKENS))
    for (const [hex, merge] of entries) {
      assert.ok(merge.token in COLOR_TOKENS, `${hex} → ${merge.token}: not a token`)
      assert.ok(!values.has(hex as (typeof COLOR_TOKENS)[keyof typeof COLOR_TOKENS]), `${hex} is a token value — an exact match, not a merge`)
    }
  })

  test('every recorded ΔE is the CIEDE2000 of the hex and its token value', () => {
    for (const [hex, merge] of entries) {
      const measured = deltaE2000(hex, COLOR_TOKENS[merge.token])
      assert.ok(Math.abs(measured - merge.dE) <= 0.006, `${hex} → ${merge.token}: recorded ΔE ${merge.dE}, measured ${measured.toFixed(3)}`)
    }
    // The formula itself: identical colours are 0 apart, and a known pair.
    assert.equal(deltaE2000('#2c6e33', '#2c6e33'), 0)
    assert.equal(deltaE2000('#e2e8df', '#e2ece3').toFixed(2), '1.79')
  })

  test('each entry stays within the bound of the rule the user approved', () => {
    for (const [hex, merge] of entries) {
      const nearest = Object.keys(COLOR_TOKENS).reduce((best, name) =>
        deltaE2000(hex, COLOR_TOKENS[name as keyof typeof COLOR_TOKENS]) < deltaE2000(hex, COLOR_TOKENS[best as keyof typeof COLOR_TOKENS]) ? name : best)
      switch (merge.rule) {
        case 'near':
          // Part A: into one of the first twelve tokens, the nearest of all 22, below ΔE 2.
          assert.ok(ORIGINAL_TOKENS.includes(merge.token), `${hex}: near-duplicate of ${merge.token}, not an original token`)
          assert.ok(merge.dE < 2, `${hex}: ΔE ${merge.dE} is not below 2`)
          assert.equal(nearest, merge.token, `${hex}: ${nearest} is nearer than ${merge.token}`)
          assert.equal(merge.anchor, undefined)
          break
        case 'member':
          // Part B: a near-duplicate (ΔE ≤ 2) of one of the ten D-T1 tokens.
          assert.ok(NEW_TOKENS.includes(merge.token), `${hex}: member of ${merge.token}, not a D-T1 token`)
          assert.ok(merge.dE <= 2, `${hex}: ΔE ${merge.dE} above 2`)
          assert.equal(merge.anchor, undefined)
          break
        case 'fold':
          // Part B, approved folds: the anchor's own entry is in the table, same token, and
          // nothing lands farther from the token than the largest approved figure (3.75).
          assert.ok(NEW_TOKENS.includes(merge.token), `${hex}: fold into ${merge.token}, not a D-T1 token`)
          assert.ok(merge.dE <= 3.75, `${hex}: ΔE ${merge.dE} above 3.75`)
          assert.ok(merge.anchor && COLOR_MERGES[merge.anchor]?.token === merge.token, `${hex}: anchor ${merge.anchor} is not folded into ${merge.token}`)
          break
        default:
          assert.fail(`${hex}: unknown rule ${String(merge.rule)}`)
      }
    }
  })

  test('only the three approved folds exist', () => {
    const folds = new Map<string, string>()
    for (const merge of Object.values(COLOR_MERGES)) if (merge.rule === 'fold') folds.set(merge.anchor!, merge.token)
    assert.deepEqual(Object.fromEntries([...folds].sort()), { '#385932': 'brand-800', '#556450': 'ink-soft', '#fff4f3': 'danger-bg' })
  })

  test('colours the decision keeps as hex are not in the table', () => {
    const kept = [
      // The red family keeps its own meaning.
      '#a32924', '#b42318', '#b71c1c', '#b0403c',
      // ΔE 2–3 from the nearest token: not merged.
      '#e4f2e5', '#d5e1d3', '#c62828', '#e4f0e2',
      // Fold entries that measured farther from the token than approved: held for a new decision.
      '#2d5a27', '#245b2a', '#2e5a28', '#245928', '#245a2a', '#fff5f4', '#fdf6f6', '#fff8f7', '#fff6f5',
    ]
    for (const hex of kept) assert.equal(COLOR_MERGES[hex], undefined, `${hex} must stay an arbitrary hex`)
  })

  test('a decorative-only token is really below 3:1 on white (the reason it is never a focus indicator)', () => {
    assert.deepEqual([...DECORATIVE_ONLY_TOKENS], ['accent'])
    for (const name of DECORATIVE_ONLY_TOKENS) {
      assert.ok(contrastOnWhite(COLOR_TOKENS[name]) < 3, `${name}: ${contrastOnWhite(COLOR_TOKENS[name]).toFixed(2)}:1`)
    }
    assert.ok(contrastOnWhite(COLOR_TOKENS['brand-600']) >= 3, 'the focus colour itself reaches 3:1')
  })
})
