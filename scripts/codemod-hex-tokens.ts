/**
 * Rewrites Tailwind arbitrary hex colours into the semantic tokens of
 * `shared/color-tokens.ts`, without changing a pixel (wave3-long-term D-TOKENS, task 3.2).
 *
 *   node --experimental-strip-types scripts/codemod-hex-tokens.ts [--write] [--merges] <dir|file>…
 *
 * Dry run by default: prints, per file, `file: N replacements (value→token ×n, …)` and
 * the `[#hex]` values it left alone (with the reason), then a summary. `--write`
 * writes the files. It runs on plain Node (no ts-resolver), so imports carry `.ts`.
 *
 * `--merges` (off by default) ALSO rewrites the hexes of `shared/color-merges.ts`: values
 * the user decided to fold into a token although they differ from it (decision D-T1).
 * Those rewrites change the colour, by the CIEDE2000 difference the table records; the
 * per-file report prints it for every rewrite (`#e2e8df→line (ΔE 1.79) ×3`, an exact
 * match as ΔE 0) and the summary buckets them. Every guard below applies to them as to
 * an exact match. Without the flag only exact matches are rewritten, and the report is
 * unchanged (no ΔE).
 *
 * What it rewrites: `<prefix>-[#hex]` → `<prefix>-<token>` for every Tailwind v3 colour
 * utility (COLOR_PREFIXES), when the hex is EXACTLY a token value (case-insensitive;
 * a 3-digit hex only when its expansion is exactly a token value) or, with `--merges`,
 * an entry of the merge table. Everything before
 * the prefix (variants such as `hover:`/`md:`/`group-hover/x:`/`[&>svg]:`, and `!`) and
 * after the bracket (`/30`, `/[0.35]`) is kept byte for byte. The output is always a
 * literal class name — never an interpolation — because Tailwind only generates CSS
 * for class names it can read in the source. `:class` objects, arrays and template
 * strings are handled as plain text, like Tailwind's own scanner does.
 *
 * What it leaves alone, and reports:
 *   unmapped          the hex is not a token value — near-duplicates included (`#2c6e34`
 *                     is not `#2c6e33`) — nor, with `--merges`, in the merge table
 *   indicator         the token may only decorate (DECORATIVE_ONLY_TOKENS: under 3:1 on
 *                     white) and the utility is a ring, an outline, or any colour under a
 *                     focus variant — a focus indicator is never given that name
 *   alpha / invalid   4/8-digit hex (alpha channel), 5/7-digit hex
 *   suffix            anything after `]` other than `/<number>` or `/[<number>]`,
 *                     e.g. a dynamic `/${alpha}` — the rewrite would not be a literal
 *   style             inside a `<style>` block or a `style=` / `:style=` attribute
 *   type-hint         `bg-[color:#…]`: an explicitly typed arbitrary value is never
 *                     touched (0 in app/ when written; not counted by the hex ratchet)
 *   no-colour-prefix  `[#hex]` that is not the value of a colour utility (`xbg-[#…]`)
 *   order             renaming would change which of two colour classes on one element
 *                     wins the cascade — see scripts/codemod-hex-tokens-order.ts
 *   order-merge       the same, for two classes written in different places that meet on
 *                     one element: a `:class` variable/computed/helper, an imported module,
 *                     a child component's root, a prop (reported `via` the source kind) —
 *                     see scripts/codemod-hex-tokens-reach.ts
 * A hex that is not in Tailwind arbitrary-value brackets (CSS, chart configs, SVG
 * attributes) is never even looked at.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { COLOR_MERGES } from '../shared/color-merges.ts'
import { COLOR_TOKENS } from '../shared/color-tokens.ts'
import { buildHexMap, buildMergeMap, isForbiddenIndicator, type LeaveReason, type LeftAlone, type MergeEntry, type Rewrite, type RewriteResult } from './codemod-hex-tokens-map.ts'
import { END_CHARS, IS_END, MERGE_GROUP, cascadeGroups, inRanges, keepCascadeOrder, variantsBefore, type CascadeMember, type Range } from './codemod-hex-tokens-order.ts'
import { mergeGroups, nodeFs, type Project, type SourceKind } from './codemod-hex-tokens-reach.ts'
import { formatFileReport, formatSummary } from './codemod-hex-tokens-report.ts'

// The tables, result shapes and report live in their own modules; the codemod's API stays here.
export { buildHexMap, buildMergeMap, formatFileReport, formatSummary }
export type { LeaveReason, LeftAlone, MergeEntry, Rewrite, RewriteResult }

/** Every Tailwind v3 utility whose arbitrary value can be a colour. */
export const COLOR_PREFIXES: readonly string[] = Object.freeze([
  'bg', 'text',
  'border', 'border-x', 'border-y', 'border-s', 'border-e', 'border-t', 'border-r', 'border-b', 'border-l',
  'ring', 'ring-offset', 'outline', 'divide', 'from', 'via', 'to',
  'fill', 'stroke', 'placeholder', 'caret', 'accent', 'decoration', 'shadow',
])

/**
 * `project`: where the merge analysis reads other files (components, modules, parents) —
 * this repository by default; `false` turns the analysis off (same-tag/line order only).
 * `merges`: hexes that also map although they differ from the token (shared/color-merges.ts,
 * the CLI's `--merges`); none by default.
 */
export interface RewriteOptions {
  fileName?: string
  tokens?: Readonly<Record<string, string>>
  merges?: Readonly<Record<string, MergeEntry>>
  project?: Project | false
}

const REPO_PROJECT: Project = { root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), fs: nodeFs }

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')
const byLengthDesc = (a: string, b: string) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0)

// Longest first, so `ring-offset` wins over `ring` and `border-x` over `border`.
const PREFIX_ALT = [...COLOR_PREFIXES].sort(byLengthDesc).map(escapeRe).join('|')
/** `bg-[#2c6e33]` + whatever follows up to the end of the class (validated afterwards). */
const HEX_UTILITY = new RegExp(`(?<![\\w-])(${PREFIX_ALT})-\\[#([0-9a-fA-F]{3,8})\\]([^${END_CHARS}]*)`, 'g')
/** `bg-[color:#2c6e33]` — a typed arbitrary value. */
const TYPED_HEX_UTILITY = new RegExp(`(?<![\\w-])(${PREFIX_ALT})-\\[([a-zA-Z][\\w-]*):#([0-9a-fA-F]+)\\]`, 'g')
/** The hex ratchet's metric (design.md D-R): every `[#hex]`. */
const RATCHET_HEX = /\[#[0-9a-fA-F]{3,8}\]/g
const OPACITY_SUFFIX = /^(?:\/(?:\d+(?:\.\d+)?|\[(?:\d*\.)?\d+%?\]))?$/
const OPACITY_SOURCE = '(?:\\/(?:\\d+(?:\\.\\d+)?|\\[[^\\]\\s]+\\]))?'
/** Named colours of Tailwind's default palette, plus arbitrary colours that are not hex. */
const DEFAULT_COLOURS = '(?:inherit|current|transparent|black|white'
  + '|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|[1-9]00|950)'
  + '|\\[(?:rgba?|hsla?)\\([^\\]\\s]*\\)\\]|\\[var\\(--[^\\]\\s]+\\)\\]|\\[color:[^\\]\\s]+\\])'

interface Prepared {
  hexMap: Map<string, string>
  mergeMap: Map<string, MergeEntry>
  /** Whether this run has a merge table: every rewrite then reports its ΔE (0 when exact). */
  merging: boolean
  named: RegExp
  colourOfNamed: (prefix: string, text: string) => string
}
const NO_MERGES: Readonly<Record<string, MergeEntry>> = Object.freeze({})
/** Keyed by the token table, then by the merge table: one process may run both modes (the tests do). */
const preparedCache = new WeakMap<object, WeakMap<object, Prepared>>()
function prepare(tokens: Readonly<Record<string, string>>, merges: Readonly<Record<string, MergeEntry>> = NO_MERGES): Prepared {
  let byMerges = preparedCache.get(tokens)
  if (!byMerges) {
    byMerges = new WeakMap()
    preparedCache.set(tokens, byMerges)
  }
  let prepared = byMerges.get(merges)
  if (!prepared) {
    const hexMap = buildHexMap(tokens)
    const mergeMap = buildMergeMap(tokens, merges)
    const names = Object.keys(tokens).sort(byLengthDesc)
    const tokenAlt = names.map(escapeRe).join('|')
    const colour = tokenAlt ? `(?:${tokenAlt}|${DEFAULT_COLOURS})` : DEFAULT_COLOURS
    const named = new RegExp(`(?<![\\w-])(${PREFIX_ALT})-${colour}${OPACITY_SOURCE}(?=[${END_CHARS}]|$)`, 'g')
    /** `bg-ink-secondary/30` → `#4a5545/30` (same spelling as a hex member's colour); `bg-red-50` → `red-50`. */
    const colourOfNamed = (prefix: string, text: string) => {
      const rest = text.slice(prefix.length + 1)
      const token = names.find((n) => rest === n || rest.startsWith(`${n}/`))
      return token ? `${tokens[token]!.toLowerCase()}${rest.slice(token.length)}` : rest
    }
    prepared = { hexMap, mergeMap, merging: merges !== NO_MERGES, named, colourOfNamed }
    byMerges.set(merges, prepared)
  }
  return prepared
}

/** `<style>` blocks and `style=` / `:style=` / `v-bind:style=` attribute values. */
function styleRanges(source: string): Range[] {
  const ranges: Range[] = []
  for (const m of source.matchAll(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi)) ranges.push([m.index, m.index + m[0].length])
  for (const m of source.matchAll(/(?<![\w-])(?:v-bind)?:?style\s*=\s*(?:"[^"]*"|'[^']*')/g)) ranges.push([m.index, m.index + m[0].length])
  return ranges
}

/** The whole class around `index` (for reporting a `[#hex]` that is not a colour utility). */
function classAround(source: string, index: number): string {
  let start = index
  while (start > 0 && !IS_END.test(source[start - 1]!)) start--
  let end = index
  while (end < source.length && !IS_END.test(source[end]!)) end++
  return source.slice(start, end)
}

function expandHex(hex: string): string {
  const lower = hex.toLowerCase()
  return lower.length === 3 ? [...lower].map((c) => c + c).join('') : lower
}
/** The colour a `[#hex]<tail>` sets, spelling aside (`#4A5545` and `#4a5545` are one colour). */
const hexColour = (hex: string, tail: string) => `#${expandHex(hex)}${tail}`

interface Member extends CascadeMember {
  index: number
  end: number
  rewrite?: Rewrite
  extraGroups: string[]
  /** Merge group → how this class reaches that element (for the `order-merge` report). */
  via: Map<string, SourceKind>
}

type Planned = Omit<Rewrite, 'index' | 'from'>

/**
 * The token form of one `<prefix>-[#hex]<tail>` written after `variants` (`hover:`,
 * `focus-visible:!`…), or why it keeps its text. An exact match wins over the merge table.
 */
function plan(prefix: string, hex: string, tail: string, variants: string, prepared: Prepared): Planned | LeaveReason {
  if (!OPACITY_SUFFIX.test(tail)) return 'suffix'
  if (hex.length === 4 || hex.length === 8) return 'alpha'
  if (hex.length !== 3 && hex.length !== 6) return 'invalid'
  const value = `#${expandHex(hex)}`
  const exact = prepared.hexMap.get(value)
  const merge = exact ? undefined : prepared.mergeMap.get(value)
  const token = exact ?? merge?.token
  if (!token) return 'unmapped'
  if (isForbiddenIndicator(token, prefix, variants)) return 'indicator'
  const change = merge ? { dE: merge.dE, ...(merge.rule ? { rule: merge.rule } : {}) } : prepared.merging ? { dE: 0 } : {}
  return { to: `${prefix}-${token}${tail}`, value, token, ...change }
}

/**
 * Members for the classes of other files that meet this file's classes on one element
 * (scripts/codemod-hex-tokens-reach.ts). They are `fixed` — another file — and checked in
 * both states that file can be in: as written, and as this codemod would write it.
 */
function mergeMembers(source: string, isSfc: boolean, options: RewriteOptions, members: Member[], prepared: Prepared): Member[] {
  if (options.project === false) return []
  const project = options.project ?? REPO_PROJECT
  const file = options.fileName ? path.resolve(options.fileName) : path.join(project.root, isSfc ? 'inline.vue' : 'inline.ts')
  const external: Member[] = []
  for (const group of mergeGroups(file, source, project)) {
    const key = `${MERGE_GROUP}${group.key}`
    for (const piece of group.pieces) {
      if (piece.file === file) {
        for (const m of members) {
          if (m.index < piece.range[0] || m.index >= piece.range[1]) continue
          const g = key + m.group.slice(m.group.indexOf('|'))
          if (!m.via.has(g)) { m.extraGroups.push(g); m.via.set(g, piece.kind) }
        }
        continue
      }
      const masked = styleRanges(piece.text)
      const add = (index: number, before: string, prefix: string, later: string, colour: string) => {
        if (inRanges(index, masked)) return
        const g = `${key}|${variantsBefore(piece.text, index)}|${prefix}`
        external.push({ index: -1, end: -1, group: g, before, after: before, fixed: true, later, colour, extraGroups: [], via: new Map([[g, piece.kind]]) })
      }
      for (const m of piece.text.matchAll(HEX_UTILITY)) {
        const planned = plan(m[1]!, m[2]!, m[3] ?? '', variantsBefore(piece.text, m.index), prepared)
        add(m.index, m[0], m[1]!, typeof planned === 'string' ? m[0] : planned.to, hexColour(m[2]!, m[3] ?? ''))
      }
      for (const m of piece.text.matchAll(prepared.named)) add(m.index, m[0], m[1]!, m[0], prepared.colourOfNamed(m[1]!, m[0]))
    }
  }
  return external
}

export function rewriteSource(source: string, options: RewriteOptions = {}): RewriteResult {
  const prepared = prepare(options.tokens ?? COLOR_TOKENS, options.merges)
  const { named } = prepared
  const isSfc = options.fileName ? options.fileName.endsWith('.vue') : /<template[\s>]/.test(source)
  const masked = styleRanges(source)
  const groupOf = cascadeGroups(source, isSfc)
  const leftAlone: LeftAlone[] = []
  const members: Member[] = []
  const coveredBrackets = new Set<number>()

  for (const m of source.matchAll(HEX_UTILITY)) {
    const text = m[0]
    const prefix = m[1]!
    const index = m.index
    coveredBrackets.add(index + prefix.length + 1)
    const value = `#${m[2]!.toLowerCase()}`
    if (inRanges(index, masked)) { leftAlone.push({ index, text, value, reason: 'style' }); continue }
    const member: Member = { index, end: index + text.length, group: groupOf(index, prefix), before: text, after: text, colour: hexColour(m[2]!, m[3] ?? ''), extraGroups: [], via: new Map() }
    members.push(member)
    const planned = plan(prefix, m[2]!, m[3] ?? '', variantsBefore(source, index), prepared)
    if (typeof planned === 'string') { leftAlone.push({ index, text, value, reason: planned }); continue }
    member.after = planned.to
    member.rewrite = { index, from: text, ...planned }
  }

  for (const m of source.matchAll(RATCHET_HEX)) {
    if (coveredBrackets.has(m.index)) continue
    leftAlone.push({
      index: m.index,
      text: classAround(source, m.index),
      value: m[0].slice(1, -1).toLowerCase(),
      reason: inRanges(m.index, masked) ? 'style' : 'no-colour-prefix',
    })
  }
  for (const m of source.matchAll(TYPED_HEX_UTILITY)) {
    leftAlone.push({ index: m.index, text: m[0], value: `#${m[3]!.toLowerCase()}`, reason: 'type-hint' })
  }

  // Named colour utilities share the cascade with the hex ones (they never change).
  for (const m of source.matchAll(named)) {
    if (inRanges(m.index, masked)) continue
    members.push({ index: m.index, end: m.index + m[0].length, group: groupOf(m.index, m[1]!), before: m[0], after: m[0], colour: prepared.colourOfNamed(m[1]!, m[0]), extraGroups: [], via: new Map() })
  }

  // A rewrite that would change which colour wins on an element is undone (see the order
  // module) — on one tag/line (`order`), or where classes from elsewhere meet (`order-merge`).
  const external = mergeMembers(source, isSfc, options, members, prepared)
  keepCascadeOrder([...members, ...external], (member, { group, partner }) => {
    const merge = group.startsWith(MERGE_GROUP)
    const partnerVia = partner.via.get(group)
    const via = partnerVia && partnerVia !== 'self' ? partnerVia : member.via.get(group) ?? partnerVia
    const value = member.rewrite!.value
    leftAlone.push(merge ? { index: member.index, text: member.before, value, reason: 'order-merge', ...(via ? { via } : {}), partner: partner.before } : { index: member.index, text: member.before, value, reason: 'order' })
    member.rewrite = undefined
  })

  const rewrites = members.flatMap((member) => (member.rewrite ? [member.rewrite] : [])).sort((a, b) => a.index - b.index)
  let output = ''
  let cursor = 0
  for (const rewrite of rewrites) {
    output += source.slice(cursor, rewrite.index) + rewrite.to
    cursor = rewrite.index + rewrite.from.length
  }
  output += source.slice(cursor)
  leftAlone.sort((a, b) => a.index - b.index)
  return { output, rewrites, leftAlone }
}

const SOURCE_EXTENSIONS = new Set(['.vue', '.ts', '.js'])
const SKIP_DIRS = new Set(['node_modules', '.nuxt', '.output', '.git', '.data'])

/** `.vue`/`.ts`/`.js` files under each path (a file path is taken as is), sorted. */
export function collectFiles(paths: readonly string[]): string[] {
  const files = new Set<string>()
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) walk(full)
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        files.add(full)
      }
    }
  }
  for (const target of paths) {
    if (statSync(target).isDirectory()) walk(target)
    else files.add(target)
  }
  return [...files].sort()
}

const USAGE = 'usage: node --experimental-strip-types scripts/codemod-hex-tokens.ts [--write] [--merges] <dir|file>…'
const OPTIONS = new Set(['--write', '--merges'])

export interface Io { log(line: string): void; error(line: string): void }
const STDIO: Io = { log: (line) => process.stdout.write(`${line}\n`), error: (line) => process.stderr.write(`${line}\n`) }

/** `merges`: the table `--merges` applies (shared/color-merges.ts; a test passes its own). */
export function main(argv: readonly string[], io: Io = STDIO, merges: Readonly<Record<string, MergeEntry>> = COLOR_MERGES): number {
  if (argv.includes('--help') || argv.includes('-h')) { io.log(USAGE); return 0 }
  const unknown = argv.filter((arg) => arg.startsWith('-') && !OPTIONS.has(arg))
  if (unknown.length) { io.error(`unknown option: ${unknown.join(' ')}`); io.error(USAGE); return 2 }
  const write = argv.includes('--write')
  const options: RewriteOptions = argv.includes('--merges') ? { merges } : {}
  const targets = argv.filter((arg) => !arg.startsWith('-'))
  if (!targets.length) { io.error(USAGE); return 2 }
  const missing = targets.filter((target) => !existsSync(target))
  if (missing.length) { io.error(`not found: ${missing.join(' ')}`); return 2 }

  const entries: Array<{ file: string; result: RewriteResult }> = []
  for (const file of collectFiles(targets)) {
    const source = readFileSync(file, 'utf8')
    const result = rewriteSource(source, { ...options, fileName: file })
    const shown = (path.relative(process.cwd(), file) || file).split(path.sep).join('/')
    entries.push({ file: shown, result })
    const report = formatFileReport(shown, result)
    if (report) io.log(report)
    if (write && result.output !== source) writeFileSync(file, result.output)
  }
  io.log('')
  io.log(formatSummary(entries, { write }))
  return 0
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
