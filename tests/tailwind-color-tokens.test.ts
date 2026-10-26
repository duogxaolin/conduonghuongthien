/**
 * Semantic colour tokens in `tailwind.config.js` (wave3-long-term D-TOKENS, task 3.1).
 *
 * The tokens are the vocabulary `scripts/codemod-hex-tokens.ts` rewrites `bg-[#2c6e33]`
 * into. That rewrite is only pixel-neutral if four things hold, and each test below
 * pins one of them against the REAL config, loaded the way Nuxt loads it (jiti — the
 * file is CommonJS inside a `"type": "module"` package, so a plain `import` fails):
 *
 *   1. Every token maps exactly one value, and the value is the one `openspec/ui-dna.md`
 *      names for that role. Near-duplicates (`#f8faf8` vs `#f8faf7`) are NOT folded in
 *      — merging them changes pixels and is the user's D-T1 decision.
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
import { COLOR_TOKENS } from '../shared/color-tokens.ts'

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
 * design.md table (`#2c3e2e`, `#5a6c58`, `#f8faf8`). Those three design values stay
 * arbitrary hexes until someone gives them a name of their own.
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
}

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
  })
})
